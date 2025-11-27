import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  Heart,
  SpeakerHigh,
} from '@phosphor-icons/react';

const defaultWsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const GRID_COLUMNS = 7;
const GRID_ROWS = 5;
const PAGE_SIZE = GRID_COLUMNS * GRID_ROWS;
const HISTORY_PAGE_SIZE = 12;

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
  const [user, setUser] = useState(() => {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem('sessionUser');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  });
  const [history, setHistory] = useState([]);
  const [authLoading, setAuthLoading] = useState(() => Boolean(
    typeof window !== 'undefined' && localStorage.getItem('sessionToken'),
  ));
  const [historyPage, setHistoryPage] = useState(1);
  const [favorites, setFavorites] = useState(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = JSON.parse(localStorage.getItem('favoriteSounds') || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch (_err) {
      return [];
    }
  });
  const socketRef = useRef(null);
  const loginWindowRef = useRef(null);

  const statusLabel = useMemo(() => {
    if (connectionState === 'ready') return 'Ready (bot connected)';
    if (connectionState === 'waiting') return 'Waiting for /join in Discord';
    if (connectionState === 'connected') return 'Connected to control server';
    return 'Disconnected';
  }, [connectionState]);

  useEffect(() => {
    if (!user) {
      setSounds([]);
      setHistory([]);
      setNowPlaying(null);
      setConnectionState('disconnected');
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      return;
    }

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
            setHistoryPage(1);
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
  }, [user]);

  useEffect(() => {
    const token = sessionToken;
    if (!token) {
      setAuthLoading(false);
      return;
    }

    const controller = new AbortController();
    setAuthLoading(true);
    fetch(`${apiBase}/auth/session?token=${token}`, { signal: controller.signal })
      .then((res) => {
        if (res.status === 401) throw new Error('unauthorized');
        if (!res.ok) throw new Error('session-check-failed');
        return res.json();
      })
      .then((data) => {
        if (data.ok) {
          setUser(data.user);
        } else {
          throw new Error('unauthorized');
        }
      })
      .catch((err) => {
        if (err.message === 'unauthorized') {
          localStorage.removeItem('sessionToken');
          localStorage.removeItem('sessionUser');
          setSessionToken(null);
          setUser(null);
        } else {
          setError('No se pudo validar la sesión. Intentaremos de nuevo en la siguiente acción.');
        }
      })
      .finally(() => {
        setAuthLoading(false);
      });

    return () => controller.abort();
  }, [sessionToken]);

  useEffect(() => {
    if (!user) {
      localStorage.removeItem('sessionUser');
      return;
    }
    localStorage.setItem('sessionUser', JSON.stringify(user));
  }, [user]);

  useEffect(() => {
    const handler = (event) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      if (payload.token && payload.user) {
        setSessionToken(payload.token);
        localStorage.setItem('sessionToken', payload.token);
        localStorage.setItem('sessionUser', JSON.stringify(payload.user));
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

  const favoriteSounds = useMemo(
    () => sounds.filter((sound) => favorites.includes(sound)),
    [sounds, favorites],
  );

  const nonFavoriteSounds = useMemo(
    () => sounds.filter((sound) => !favorites.includes(sound)),
    [sounds, favorites],
  );

  const filteredFavorites = favoriteSounds;

  const filteredNonFavorites = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nonFavoriteSounds;
    return nonFavoriteSounds.filter((sound) => sound.toLowerCase().includes(q));
  }, [nonFavoriteSounds, query]);

  const filteredTotalCount = favoriteSounds.length + filteredNonFavorites.length;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredNonFavorites.length / PAGE_SIZE));
  const paginatedNonFavorites = filteredNonFavorites.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const historyTotalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const paginatedHistory = useMemo(
    () =>
      history.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE,
      ),
    [history, historyPage],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('favoriteSounds', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setHistoryPage((prev) => Math.min(prev, historyTotalPages));
  }, [historyTotalPages]);

  const beginLogin = () => {
    const features = 'width=520,height=720,menubar=no,location=no,status=no';
    loginWindowRef.current = window.open(`${apiBase}/auth/login`, 'discord-login', features);
  };

  const logout = () => {
    setSessionToken(null);
    setUser(null);
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('sessionUser');
  };

  const toggleFavorite = (event, sound) => {
    event.stopPropagation();
    setFavorites((prev) =>
      prev.includes(sound) ? prev.filter((s) => s !== sound) : [...prev, sound],
    );
  };

  const historyLabel = (entry) => {
    const when = new Date(entry.at);
    return `${when.toLocaleDateString()} ${when.toLocaleTimeString()}`;
  };

  const avatarUrl = (u) =>
    u?.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null;

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
        <div className="auth">
          {user ? (
            <>
              <div className="user-pill" title={user.id}>
                {avatarUrl(user) ? (
                  <img className="avatar-img" src={avatarUrl(user)} alt={user.username} />
                ) : (
                  <span className="avatar-fallback">
                    {user.globalName?.[0] || user.username?.[0] || '?'}
                  </span>
                )}
                <div>
                  <p className="user-label">Conectado</p>
                  <p className="user-name">{user.globalName || user.username}</p>
                </div>
              </div>
              <button className="ghost" onClick={logout}>
                Salir
              </button>
            </>
          ) : null}
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {!user ? (
        <section className="login-screen">
          <div className="login-card">
            <p className="eyebrow">Acceso requerido</p>
            <h2>{authLoading ? 'Restaurando sesión...' : 'Conecta con Discord'}</h2>
            <p className="subtitle">
              Inicia sesión para cargar la botonera y registrar quién dispara cada sonido.
            </p>
            <button className="primary" onClick={beginLogin} disabled={authLoading}>
              {authLoading ? 'Verificando...' : 'Conectar con Discord'}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="toolbar">
            <div className="search">
              <input
                type="search"
                placeholder="Search sounds..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="search-count">
                {filteredTotalCount} / {sounds.length}
              </span>
            </div>
          </div>

          {favorites.length > 0 && (
            <section className="favorites">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Favoritos</p>
                </div>
                <p className="section-count">
                  {filteredFavorites.length} / {favoriteSounds.length}
                </p>
              </div>
              {filteredFavorites.length ? (
                <div className="grid favorites-grid">
                  {filteredFavorites.map((sound, idx) => (
                    <button
                      key={sound}
                      className={`sound-button ${palette[idx % palette.length]}`}
                      onClick={() => sendPlay(sound)}
                      disabled={
                        connectionState === 'disconnected' || connectionState === 'connecting'
                      }
                      title={sound}
                    >
                      <span
                        className="favorite-toggle"
                        onClick={(e) => toggleFavorite(e, sound)}
                        title={
                          favorites.includes(sound)
                            ? 'Quitar de favoritos'
                            : 'Agregar a favoritos'
                        }
                      >
                        <Heart
                          size={18}
                          weight={favorites.includes(sound) ? 'fill' : 'regular'}
                          className="favorite-icon"
                          aria-hidden
                        />
                        <span className="sr-only">
                          {favorites.includes(sound)
                            ? 'Quitar de favoritos'
                            : 'Agregar a favoritos'}
                        </span>
                      </span>
                      <span className="sound-name">{sound.replace(/\.[^/.]+$/, '')}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-favorites">No hay favoritos que coincidan con la búsqueda.</p>
              )}
            </section>
          )}

          <section className="grid">
            {paginatedNonFavorites.map((sound, idx) => (
              <button
                key={sound}
                className={`sound-button ${palette[idx % palette.length]}`}
                onClick={() => sendPlay(sound)}
                disabled={connectionState === 'disconnected' || connectionState === 'connecting'}
                title={sound}
              >
                <span
                  className="favorite-toggle"
                  onClick={(e) => toggleFavorite(e, sound)}
                  title={
                    favorites.includes(sound)
                      ? 'Quitar de favoritos'
                      : 'Agregar a favoritos'
                  }
                >
                  <Heart
                    size={18}
                    weight={favorites.includes(sound) ? 'fill' : 'regular'}
                    className="favorite-icon"
                    aria-hidden
                  />
                  <span className="sr-only">
                    {favorites.includes(sound)
                      ? 'Quitar de favoritos'
                      : 'Agregar a favoritos'}
                  </span>
                </span>
                <span className="sound-name">{sound.replace(/\.[^/.]+$/, '')}</span>
              </button>
            ))}
            {!sounds.length ? (
              <div className="empty">
                <p>
                  No sounds found in the <code>sounds/</code> folder.
                </p>
                <p>Add files (mp3, wav, ogg, flac) and reload.</p>
              </div>
            ) : null}
            {sounds.length > 0 && !filteredNonFavorites.length && (
              <div className="empty">
                <p>
                  {query.trim()
                    ? 'No hay sonidos que coincidan con la búsqueda (fuera de favoritos).'
                    : 'Todos tus sonidos están marcados como favoritos.'}
                </p>
              </div>
            )}
          </section>

          {filteredNonFavorites.length > PAGE_SIZE && (
            <div className="pagination">
              <button
                className="ghost icon-button"
                onClick={() => setPage(1)}
                disabled={page === 1}
                aria-label="Primera página"
              >
                <CaretDoubleLeft size={18} />
              </button>
              <button
                className="ghost icon-button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Página anterior"
              >
                <CaretLeft size={18} />
              </button>
              <span className="page-indicator">
                Página {page} de {totalPages}
              </span>
              <button
                className="ghost icon-button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Página siguiente"
              >
                <CaretRight size={18} />
              </button>
              <button
                className="ghost icon-button"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                aria-label="Última página"
              >
                <CaretDoubleRight size={18} />
              </button>
            </div>
          )}

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
                {paginatedHistory.map((entry) => (
                  <li key={`${entry.at}-${entry.sound}`}>
                    {avatarUrl(entry.user) ? (
                      <img
                        className="history-avatar"
                        src={avatarUrl(entry.user)}
                        alt={entry.user.username}
                      />
                    ) : (
                      <div className="history-avatar">
                        {entry.user.globalName?.[0] || entry.user.username?.[0] || '?'}
                      </div>
                    )}
                    <div className="history-body">
                      <p className="history-user">{entry.user.globalName || entry.user.username}</p>
                      <p className="history-meta">
                        <SpeakerHigh
                          size={18}
                          weight="fill"
                          className="history-icon"
                          aria-label="disparó"
                        />{' '}
                        <strong>{entry.sound}</strong> · {historyLabel(entry)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {history.length > HISTORY_PAGE_SIZE && (
              <div className="pagination">
                <button
                  className="ghost icon-button"
                  onClick={() => setHistoryPage(1)}
                  disabled={historyPage === 1}
                  aria-label="Primera página de historial"
                >
                  <CaretDoubleLeft size={18} />
                </button>
                <button
                  className="ghost icon-button"
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  disabled={historyPage === 1}
                  aria-label="Página anterior de historial"
                >
                  <CaretLeft size={18} />
                </button>
                <span className="page-indicator">
                  Página {historyPage} de {historyTotalPages}
                </span>
                <button
                  className="ghost icon-button"
                  onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                  disabled={historyPage === historyTotalPages}
                  aria-label="Página siguiente de historial"
                >
                  <CaretRight size={18} />
                </button>
                <button
                  className="ghost icon-button"
                  onClick={() => setHistoryPage(historyTotalPages)}
                  disabled={historyPage === historyTotalPages}
                  aria-label="Última página de historial"
                >
                  <CaretDoubleRight size={18} />
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
