import { useEffect, useMemo, useRef, useState } from 'react';

const defaultWsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function App() {
  const [sounds, setSounds] = useState([]);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [nowPlaying, setNowPlaying] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sessionToken, setSessionToken] = useState(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('sessionToken');
  });
  const [user, setUser] = useState(null);
  const [history, setHistory] = useState([]);
  const socketRef = useRef(null);
  const loginWindowRef = useRef(null);

  const statusLabel = useMemo(() => {
    if (connectionState === 'ready') return 'Ready (bot connected)';
    if (connectionState === 'waiting') return 'Waiting for /join in Discord';
    if (connectionState === 'connected') return 'Connected to control server';
    return 'Disconnected';
  }, [connectionState]);

  useEffect(() => {
    const socket = new WebSocket(defaultWsUrl);
    socketRef.current = socket;
    setConnectionState('connecting');

    socket.onopen = () => {
      setConnectionState('connected');
      setError(null);
      socket.send(JSON.stringify({ type: 'list' }));
    };

    socket.onclose = () => {
      setConnectionState('disconnected');
    };

    socket.onerror = () => {
      setError('Connection error. Is the bot running?');
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        switch (payload.type) {
          case 'sounds':
            setSounds(payload.sounds || []);
            break;
          case 'status':
            setConnectionState(payload.connected ? 'ready' : 'waiting');
            break;
          case 'nowPlaying':
            setNowPlaying(payload.name);
            break;
          case 'history':
            setHistory(payload.entries || []);
            break;
          case 'error':
            setError(payload.message || 'Unexpected error');
            break;
          default:
            break;
        }
      } catch (err) {
        setError('Bad data from server.');
      }
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    const token = sessionToken;
    if (!token) return;

    const controller = new AbortController();
    fetch(`${apiBase}/auth/session?token=${token}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('bad session');
        return res.json();
      })
      .then((data) => {
        if (data.ok) {
          setUser(data.user);
        } else {
          throw new Error('session invalid');
        }
      })
      .catch(() => {
        localStorage.removeItem('sessionToken');
        setSessionToken(null);
        setUser(null);
      });

    return () => controller.abort();
  }, [sessionToken]);

  useEffect(() => {
    const handler = (event) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      if (payload.token && payload.user) {
        setSessionToken(payload.token);
        localStorage.setItem('sessionToken', payload.token);
        setUser(payload.user);
        setError(null);
        if (loginWindowRef.current && !loginWindowRef.current.closed) {
          loginWindowRef.current.close();
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const sendPlay = (name) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected to bot control server.');
      return;
    }
    if (!sessionToken || !user) {
      setError('Necesitas iniciar sesión con Discord antes de reproducir.');
      return;
    }
    setError(null);
    socketRef.current.send(JSON.stringify({ type: 'play', name, token: sessionToken }));
  };

  const filteredSounds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sounds;
    return sounds.filter((sound) => sound.toLowerCase().includes(q));
  }, [sounds, query]);

  const beginLogin = () => {
    const features = 'width=520,height=720,menubar=no,location=no,status=no';
    loginWindowRef.current = window.open(`${apiBase}/auth/login`, 'discord-login', features);
  };

  const logout = () => {
    setSessionToken(null);
    setUser(null);
    localStorage.removeItem('sessionToken');
  };

  const historyLabel = (entry) => {
    const when = new Date(entry.at);
    return `${when.toLocaleDateString()} ${when.toLocaleTimeString()}`;
  };

  const palette = ['tone-cyan', 'tone-purple', 'tone-green', 'tone-red'];

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Discord Soundboard</p>
          <h1>Botonera Control</h1>
          <p className="subtitle">Trigger sounds in Discord straight from your browser.</p>
        </div>
        <div className="status-card">
          <div className={`status-dot status-${connectionState}`} />
          <div>
            <p className="status-label">Status</p>
            <p className="status-value">{statusLabel}</p>
            {nowPlaying && <p className="now-playing">Now playing: {nowPlaying}</p>}
          </div>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="toolbar">
        <div className="search">
          <input
            type="search"
            placeholder="Search sounds..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="search-count">
            {filteredSounds.length} / {sounds.length}
          </span>
        </div>
        <div className="auth">
          {user ? (
            <>
              <div className="user-pill" title={user.id}>
                <span className="avatar-fallback">
                  {user.globalName?.[0] || user.username?.[0] || '?'}
                </span>
                <div>
                  <p className="user-label">Conectado</p>
                  <p className="user-name">{user.globalName || user.username}</p>
                </div>
              </div>
              <button className="ghost" onClick={logout}>
                Salir
              </button>
            </>
          ) : (
            <button className="primary" onClick={beginLogin}>
              Conectar con Discord
            </button>
          )}
        </div>
      </div>

      <section className="grid">
        {filteredSounds.map((sound, idx) => (
          <button
            key={sound}
            className={`sound-button ${palette[idx % palette.length]}`}
            onClick={() => sendPlay(sound)}
            disabled={connectionState === 'disconnected' || connectionState === 'connecting'}
            title={sound}
          >
            <span className="sound-name">{sound.replace(/\.[^/.]+$/, '')}</span>
            <span className="sound-ext">{sound.split('.').pop()}</span>
          </button>
        ))}
        {!sounds.length && (
          <div className="empty">
            <p>No sounds found in the <code>sounds/</code> folder.</p>
            <p>Add files (mp3, wav, ogg, flac) and reload.</p>
          </div>
        )}
      </section>

      <section className="history">
        <div className="history-header">
          <div>
            <p className="eyebrow">Historial</p>
            <h2>Últimas reproducciones</h2>
          </div>
          <p className="history-count">{history.length} eventos</p>
        </div>
        {!history.length && <p className="empty-history">Todavía no hay reproducciones.</p>}
        {history.length > 0 && (
          <ul className="history-list">
            {history.map((entry) => (
              <li key={`${entry.at}-${entry.sound}`}>
                <div className="history-avatar">
                  {entry.user.globalName?.[0] || entry.user.username?.[0] || '?'}
                </div>
                <div className="history-body">
                  <p className="history-user">{entry.user.globalName || entry.user.username}</p>
                  <p className="history-meta">
                    disparó <strong>{entry.sound}</strong> · {historyLabel(entry)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
