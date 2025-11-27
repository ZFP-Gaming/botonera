import { useEffect, useMemo, useRef, useState } from 'react';

const defaultWsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

export default function App() {
  const [sounds, setSounds] = useState([]);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [nowPlaying, setNowPlaying] = useState(null);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

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

  const sendPlay = (name) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected to bot control server.');
      return;
    }
    setError(null);
    socketRef.current.send(JSON.stringify({ type: 'play', name }));
  };

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

      <section className="grid">
        {sounds.map((sound) => (
          <button
            key={sound}
            className="sound-button"
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
    </div>
  );
}
