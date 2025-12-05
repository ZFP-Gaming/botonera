import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  Heart,
  SpeakerHigh,
} from '@phosphor-icons/react';

const SESSION_TOKEN_KEY = 'sessionToken';
const SESSION_USER_KEY = 'sessionUser';
const SELECTED_GUILD_KEY = 'selectedGuildId';
const defaultWsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const GRID_COLUMNS = 7;
const GRID_ROWS = 5;
const PAGE_SIZE = GRID_COLUMNS * GRID_ROWS;
const HISTORY_PAGE_SIZE = 12;
const FAVORITE_KEY_ORDER = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  'q',
  'w',
  'e',
  'r',
  't',
  'y',
  'u',
  'i',
  'o',
  'p',
  'a',
  's',
  'd',
  'f',
  'g',
  'h',
  'j',
  'k',
  'l',
  ';',
  'z',
  'x',
  'c',
  'v',
  'b',
  'n',
  'm',
  ',',
  '.',
  '/',
];

export default function App() {
  const [guilds, setGuilds] = useState([]);
  const [selectedGuildId, setSelectedGuildId] = useState(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(SELECTED_GUILD_KEY);
  });
  const [sounds, setSounds] = useState([]);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [statusByGuild, setStatusByGuild] = useState({});
  const [nowPlayingByGuild, setNowPlayingByGuild] = useState({});
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [sessionToken, setSessionToken] = useState(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(SESSION_TOKEN_KEY);
  });
  const [volume, setVolume] = useState(50);
  const [user, setUser] = useState(() => {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  });
  const [history, setHistory] = useState([]);
  const [authLoading, setAuthLoading] = useState(() =>
    Boolean(typeof window !== 'undefined' && localStorage.getItem(SESSION_TOKEN_KEY)),
  );
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
    const currentStatus = selectedGuildId ? statusByGuild[selectedGuildId] : connectionState;
    if (currentStatus === 'ready') return 'Listo (bot conectado)';
    if (currentStatus === 'waiting') return 'Esperando /join en Discord';
    if (currentStatus === 'connected') return 'Conectado al servidor de control';
    return 'Desconectado';
  }, [connectionState, selectedGuildId, statusByGuild]);

  const selectedNowPlaying = useMemo(
    () => (selectedGuildId ? nowPlayingByGuild[selectedGuildId] : null),
    [nowPlayingByGuild, selectedGuildId],
  );

  useEffect(() => {
    if (!selectedGuildId) {
      setConnectionState('disconnected');
      return;
    }
    const status = statusByGuild[selectedGuildId];
    if (status) {
      setConnectionState(status);
    }
  }, [selectedGuildId, statusByGuild]);

  useEffect(() => {
    if (!user) {
      setSounds([]);
      setHistory([]);
      setHistoryPage(1);
      setNowPlayingByGuild({});
      setStatusByGuild({});
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
      setError('Error de conexión. ¿Está corriendo el bot?');
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        switch (payload.type) {
          case 'guilds': {
            const nextGuilds = Array.isArray(payload.guilds) ? payload.guilds : [];
            setGuilds(nextGuilds);
            if (nextGuilds.length) {
              setSelectedGuildId((prev) => {
                const exists = prev && nextGuilds.some((g) => g.id === prev);
                const next = exists ? prev : nextGuilds[0].id;
                if (next) localStorage.setItem(SELECTED_GUILD_KEY, next);
                return next;
              });
            }
            break;
          }
          case 'sounds':
            setSounds(payload.sounds || []);
            break;
          case 'status': {
            const guildId = payload.guildId || selectedGuildId;
            if (guildId) {
              setStatusByGuild((prev) => ({
                ...prev,
                [guildId]: payload.connected ? 'ready' : 'waiting',
              }));
              if (guildId === selectedGuildId) {
                setConnectionState(payload.connected ? 'ready' : 'waiting');
              }
            }
            break;
          }
          case 'nowPlaying': {
            const guildId = payload.guildId || selectedGuildId;
            if (guildId) {
              setNowPlayingByGuild((prev) => ({
                ...prev,
                [guildId]: payload.name,
              }));
            }
            break;
          }
          case 'history':
            setHistory(payload.entries || []);
            setHistoryPage(1);
            break;
          case 'volume': {
            const raw = typeof payload.value === 'number' ? payload.value : null;
            if (raw !== null) {
              const clamped = Math.max(0, Math.min(1, raw));
              setVolume(Math.round(clamped * 100));
            }
            break;
          }
          case 'error':
            setError(payload.message || 'Error inesperado');
            break;
          default:
            break;
        }
      } catch (err) {
        setError('Datos inválidos del servidor.');
      }
    };

    return () => socket.close();
  }, [selectedGuildId, user]);

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
          localStorage.removeItem(SESSION_TOKEN_KEY);
          localStorage.removeItem(SESSION_USER_KEY);
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
      localStorage.removeItem(SESSION_USER_KEY);
      return;
    }
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  }, [user]);

  useEffect(() => {
    const handler = (event) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      if (payload.token && payload.user) {
        localStorage.setItem(SESSION_TOKEN_KEY, payload.token);
        localStorage.setItem(SESSION_USER_KEY, JSON.stringify(payload.user));
        setSessionToken(payload.token);
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

  const sendPlay = useCallback(
    (name) => {
      if (!selectedGuildId) {
        setError('Selecciona un servidor de Discord para controlar.');
        return;
      }
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        setError('Sin conexión al servidor de control del bot.');
        return;
      }
      if (!sessionToken || !user) {
        setError('Necesitas iniciar sesión con Discord antes de reproducir.');
        return;
      }
      setError(null);
      socketRef.current.send(
        JSON.stringify({ type: 'play', name, token: sessionToken, guildId: selectedGuildId }),
      );
    },
    [selectedGuildId, sessionToken, user],
  );

  const sendVolume = useCallback(
    (value) => {
      if (!selectedGuildId) {
        setError('Selecciona un servidor de Discord para controlar.');
        return;
      }
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        setError('Sin conexión al servidor de control del bot.');
        return;
      }
      if (!sessionToken || !user) {
        setError('Necesitas iniciar sesión con Discord antes de ajustar el volumen.');
        return;
      }
      setError(null);
      socketRef.current.send(
        JSON.stringify({
          type: 'setVolume',
          value: value / 100,
          token: sessionToken,
          guildId: selectedGuildId,
        }),
      );
    },
    [selectedGuildId, sessionToken, user],
  );

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const favoriteSounds = useMemo(
    () => favorites.filter((sound) => sounds.includes(sound)),
    [sounds, favorites],
  );

  const nonFavoriteSounds = useMemo(
    () => sounds.filter((sound) => !favoriteSet.has(sound)),
    [sounds, favoriteSet],
  );

  const favoriteKeyBySound = useMemo(() => {
    const mapping = {};
    favoriteSounds.forEach((sound, idx) => {
      const key = FAVORITE_KEY_ORDER[idx];
      if (key) {
        mapping[sound] = key;
      }
    });
    return mapping;
  }, [favoriteSounds]);

  const favoriteKeyBindings = useMemo(() => {
    const bindings = new Map();
    Object.entries(favoriteKeyBySound).forEach(([sound, key]) => {
      bindings.set(key.toLowerCase(), sound);
    });
    return bindings;
  }, [favoriteKeyBySound]);

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
  const filteredHistory = useMemo(
    () => history.filter((entry) => !selectedGuildId || entry.guildId === selectedGuildId),
    [history, selectedGuildId],
  );
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
  const paginatedHistory = useMemo(
    () =>
      filteredHistory.slice(
        (historyPage - 1) * HISTORY_PAGE_SIZE,
        historyPage * HISTORY_PAGE_SIZE,
      ),
    [filteredHistory, historyPage],
  );

  useEffect(() => {
    if (!favoriteKeyBindings.size) return undefined;
    const handler = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tagName = target?.tagName;
      const isTyping =
        tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable;
      if (isTyping || !user) return;
      const key = event.key.toLowerCase();
      const sound = favoriteKeyBindings.get(key);
      if (!sound) return;
      event.preventDefault();
      sendPlay(sound);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [favoriteKeyBindings, sendPlay, user]);

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

  useEffect(() => {
    setPage(1);
    setHistoryPage(1);
  }, [selectedGuildId]);

  const handleGuildChange = (event) => {
    const nextId = event.target.value;
    setSelectedGuildId(nextId);
    localStorage.setItem(SELECTED_GUILD_KEY, nextId);
    setConnectionState(statusByGuild[nextId] || 'disconnected');
    setError(null);
  };

  const beginLogin = () => {
    const features = 'width=520,height=720,menubar=no,location=no,status=no';
    loginWindowRef.current = window.open(`${apiBase}/auth/login`, 'discord-login', features);
  };

  const logout = () => {
    setSessionToken(null);
    setUser(null);
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
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
  const [draggingSound, setDraggingSound] = useState(null);

  const handleDragStart = (event, sound) => {
    event.dataTransfer?.setData('text/plain', sound);
    setDraggingSound(sound);
  };

  const handleDragEnd = () => {
    setDraggingSound(null);
  };

  const handleDrop = (event, targetSound) => {
    event.preventDefault();
    setFavorites((prev) => {
      if (!draggingSound || draggingSound === targetSound) return prev;
      const fromIdx = prev.indexOf(draggingSound);
      const toIdx = prev.indexOf(targetSound);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, draggingSound);
      return next;
    });
    setDraggingSound(null);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  useEffect(() => {
    if (!user) {
      setVolume(50);
    }
  }, [user]);

  const handleVolumeChange = (event) => {
    const next = Number(event.target.value);
    setVolume(next);
    sendVolume(next);
  };

  const volumeDisabled =
    !user ||
    !selectedGuildId ||
    connectionState === 'disconnected' ||
    connectionState === 'connecting';

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Botonera de Discord</p>
          <h1>Panel de la Botonera</h1>
          <p className="subtitle">Lanza sonidos en Discord directo desde tu navegador.</p>
        </div>
        <div className="status-card">
          <div className={`status-dot status-${connectionState}`} />
          <div>
            <p className="status-label">Estado</p>
            <p className="status-value">{statusLabel}</p>
            {selectedNowPlaying && (
              <p className="now-playing">Reproduciendo: {selectedNowPlaying}</p>
            )}
          </div>
        </div>
        <div className="server-picker">
          <label htmlFor="server-select">Servidor de Discord</label>
          <select
            id="server-select"
            value={selectedGuildId || ''}
            onChange={handleGuildChange}
            aria-label="Seleccionar servidor"
            disabled={!guilds.length}
          >
            {guilds.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name || guild.id}
              </option>
            ))}
          </select>
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
                      draggable
                      onDragStart={(e) => handleDragStart(e, sound)}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, sound)}
                      data-dragging={draggingSound === sound}
                      disabled={
                        connectionState === 'disconnected' || connectionState === 'connecting'
                      }
                      title={sound}
                    >
                      {favoriteKeyBySound[sound] && (
                        <span className="favorite-key" aria-hidden="true">
                          {favoriteKeyBySound[sound]}
                        </span>
                      )}
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

          <div className="toolbar">
            <div className="search">
              <input
                type="search"
                placeholder="Buscar sonidos..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="search-count">
                {filteredTotalCount} / {sounds.length}
              </span>
            </div>
            <div className="volume-control" aria-live="polite">
              <label htmlFor="volume-slider">Volumen</label>
              <input
                id="volume-slider"
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={handleVolumeChange}
                disabled={volumeDisabled}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={volume}
              />
              <span className="volume-value">{volume}%</span>
            </div>
          </div>

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
                  No se encontraron sonidos en la carpeta <code>sounds/</code>.
                </p>
                <p>Agrega archivos (mp3, wav, ogg, flac) y vuelve a cargar.</p>
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
              <p className="history-count">{filteredHistory.length} eventos</p>
            </div>
            {!filteredHistory.length && (
              <p className="empty-history">Todavía no hay reproducciones para este servidor.</p>
            )}
            {filteredHistory.length > 0 && (
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
            {filteredHistory.length > HISTORY_PAGE_SIZE && (
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
