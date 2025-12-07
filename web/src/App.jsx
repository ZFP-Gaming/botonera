import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretLeft,
  CaretRight,
  Heart,
  SignOut,
  SpeakerHigh,
} from '@phosphor-icons/react';
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { cn } from './lib/utils';

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

  const palette = [
    'ring-1 ring-indigo-400/40 hover:ring-indigo-300/60 shadow-indigo-500/20',
    'ring-1 ring-emerald-400/35 hover:ring-emerald-300/55 shadow-emerald-500/20',
    'ring-1 ring-sky-400/35 hover:ring-sky-300/55 shadow-sky-500/20',
    'ring-1 ring-amber-400/35 hover:ring-amber-300/55 shadow-amber-500/20',
    'ring-1 ring-rose-400/35 hover:ring-rose-300/55 shadow-rose-500/20',
  ];
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

  const statusTone = useMemo(
    () =>
      ({
        ready: { badge: 'success', dot: 'bg-emerald-400' },
        waiting: { badge: 'warning', dot: 'bg-amber-300' },
        connecting: { badge: 'secondary', dot: 'bg-sky-200' },
        connected: { badge: 'secondary', dot: 'bg-sky-300' },
        disconnected: { badge: 'danger', dot: 'bg-rose-400' },
      }[connectionState] || { badge: 'danger', dot: 'bg-rose-400' }),
    [connectionState],
  );

  return (
    <div className="min-h-screen pb-12">
      <div className="container space-y-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/40 via-slate-900 to-slate-950 shadow-lg">
              <img src="/botonera.png" alt="Botonera" className="h-full w-full object-contain" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/25 via-transparent to-cyan-500/20" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Botonera</p>
              <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">Panel de sonidos</h1>
              <p className="text-sm text-muted-foreground">
                Reproduce efectos y controla el bot en tus servidores de Discord.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-border/60 bg-slate-900/60 px-3 py-1.5 text-sm shadow-soft">
              <span className={cn('h-2 w-2 rounded-full', statusTone.dot)} aria-hidden />
              <span className="font-medium">{statusLabel}</span>
            </div>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {guilds.length ? `${guilds.length} servidores` : 'Sin servidores'}
            </Badge>
          </div>
        </header>

        {error && (
          <Card className="border-destructive/40 bg-destructive/15 text-destructive-foreground">
            <CardContent className="flex items-start gap-3 py-4">
              <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-destructive" aria-hidden />
              <div>
                <p className="font-semibold">Algo salió mal</p>
                <p className="text-sm">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {!user ? (
          <Card className="overflow-hidden border-dashed border-border/70 bg-card/70 shadow-soft">
            <CardHeader className="space-y-3">
              <Badge variant="secondary" className="w-fit">
                Acceso requerido
              </Badge>
              <CardTitle>{authLoading ? 'Restaurando sesión...' : 'Conecta con Discord'}</CardTitle>
              <CardDescription>
                Inicia sesión para cargar la botonera y registrar quién reproduce cada sonido.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Guardamos tu sesión en este navegador para que no tengas que reautenticarte cada vez.
              </p>
              <Button size="lg" onClick={beginLogin} disabled={authLoading}>
                {authLoading ? 'Verificando...' : 'Conectar con Discord'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="relative overflow-hidden">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400" />
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Actividad del bot
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedNowPlaying ? (
                          <Badge variant="secondary" className="bg-slate-800/80">
                            <SpeakerHigh size={16} weight="fill" className="mr-1" />
                            Reproduciendo: {selectedNowPlaying}
                          </Badge>
                        ) : (
                          <p className="text-sm text-muted-foreground">Sin reproducción activa.</p>
                        )}
                      </div>
                    </div>
                    <Badge variant="muted">Sesión activa</Badge>
                  </div>
                  <CardDescription>
                    Conéctate al canal de voz en Discord con{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
                      /join
                    </code>
                    . Desde aquí controlas las colas de sonido y el volumen.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="server-select">Servidor de Discord</Label>
                    <select
                      id="server-select"
                      value={selectedGuildId || ''}
                      onChange={handleGuildChange}
                      aria-label="Seleccionar servidor"
                      disabled={!guilds.length}
                      className="h-11 w-full rounded-lg border border-border bg-background/80 px-3 text-sm font-medium text-foreground shadow-soft outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                    >
                      {guilds.map((guild) => (
                        <option key={guild.id} value={guild.id}>
                          {guild.name || guild.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2" aria-live="polite">
                    <Label htmlFor="volume-slider">Volumen</Label>
                    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-slate-900/50 px-3 py-3 shadow-soft">
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
                        className="flex-1"
                      />
                      <Badge variant="secondary" className="shrink-0">
                        {volume}%
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-soft">
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        {avatarUrl(user) ? (
                          <AvatarImage src={avatarUrl(user)} alt={user.username} />
                        ) : (
                          <AvatarFallback>
                            {user.globalName?.[0] || user.username?.[0] || '?'}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          Conectado como
                        </p>
                        <p className="text-lg font-semibold leading-tight">
                          {user.globalName || user.username}
                        </p>
                        <p className="text-sm text-muted-foreground">ID: {user.id}</p>
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={logout}>
                      <SignOut size={16} weight="bold" className="mr-2" />
                      Cerrar sesión
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="muted">{sounds.length} sonidos</Badge>
                    <Badge variant="muted">{favorites.length} favoritos</Badge>
                  </div>
                  <CardDescription>
                    La sesión se guarda localmente. Puedes cerrar sesión en cualquier momento.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>

            {favorites.length > 0 && (
              <Card className="border-border/70 bg-card/70 shadow-soft">
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-xl font-semibold">Favoritos</CardTitle>
                  <Badge variant="secondary">
                    {filteredFavorites.length} / {favoriteSounds.length}
                  </Badge>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {filteredFavorites.length ? (
                    filteredFavorites.map((sound, idx) => (
                      <button
                        key={sound}
                        className={cn('sound-tile', palette[idx % palette.length])}
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
                          role="button"
                          tabIndex={0}
                          className="favorite-toggle-btn"
                          aria-pressed={favorites.includes(sound)}
                          aria-label={
                            favorites.includes(sound)
                              ? 'Quitar de favoritos'
                              : 'Agregar a favoritos'
                          }
                          title={
                            favorites.includes(sound)
                              ? 'Quitar de favoritos'
                              : 'Agregar a favoritos'
                          }
                          onClick={(e) => toggleFavorite(e, sound)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleFavorite(e, sound);
                            }
                          }}
                        >
                          <Heart
                            size={18}
                            weight={favorites.includes(sound) ? 'fill' : 'regular'}
                            className="text-pink-200"
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
                    ))
                  ) : (
                    <p className="col-span-full text-sm text-muted-foreground">
                      No hay favoritos que coincidan con la búsqueda.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-border/70 bg-card/70 shadow-soft">
              <CardHeader className="flex flex-col gap-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[220px] flex-1">
                    <Label htmlFor="search">Buscar sonidos</Label>
                    <Input
                      id="search"
                      type="search"
                      placeholder="Filtrar sonidos..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted">
                      {filteredTotalCount} / {sounds.length} sonidos
                    </Badge>
                    <Badge variant="muted">
                      Página {page} de {totalPages}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {paginatedNonFavorites.map((sound, idx) => (
                  <button
                    key={sound}
                    className={cn('sound-tile', palette[idx % palette.length])}
                    onClick={() => sendPlay(sound)}
                    disabled={connectionState === 'disconnected' || connectionState === 'connecting'}
                    title={sound}
                  >
                    <span
                      role="button"
                      tabIndex={0}
                      className="favorite-toggle-btn"
                      aria-pressed={favorites.includes(sound)}
                      aria-label={
                        favorites.includes(sound)
                          ? 'Quitar de favoritos'
                          : 'Agregar a favoritos'
                      }
                      title={
                        favorites.includes(sound) ? 'Quitar de favoritos' : 'Agregar a favoritos'
                      }
                      onClick={(e) => toggleFavorite(e, sound)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleFavorite(e, sound);
                        }
                      }}
                    >
                      <Heart
                        size={18}
                        weight={favorites.includes(sound) ? 'fill' : 'regular'}
                        className="text-pink-200"
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
                  <div className="col-span-full rounded-lg border border-dashed border-border/70 bg-slate-900/40 px-4 py-6 text-center text-sm text-muted-foreground">
                    <p>
                      No se encontraron sonidos en la carpeta <code>sounds/</code>.
                    </p>
                    <p className="mt-1">
                      Agrega archivos (mp3, wav, ogg, flac) y vuelve a cargar.
                    </p>
                  </div>
                ) : null}
                {sounds.length > 0 && !filteredNonFavorites.length && (
                  <div className="col-span-full rounded-lg border border-dashed border-border/70 bg-slate-900/40 px-4 py-6 text-center text-sm text-muted-foreground">
                    <p>
                      {query.trim()
                        ? 'No hay sonidos que coincidan con la búsqueda (fuera de favoritos).'
                        : 'Todos tus sonidos están marcados como favoritos.'}
                    </p>
                  </div>
                )}
              </CardContent>
              {filteredNonFavorites.length > PAGE_SIZE && (
                <div className="flex items-center justify-center gap-2 pb-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    aria-label="Primera página"
                  >
                    <CaretDoubleLeft size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    aria-label="Página anterior"
                  >
                    <CaretLeft size={18} />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {page} de {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    aria-label="Página siguiente"
                  >
                    <CaretRight size={18} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    aria-label="Última página"
                  >
                    <CaretDoubleRight size={18} />
                  </Button>
                </div>
              )}
            </Card>

            <Card className="border-border/70 bg-card/70 shadow-soft">
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Historial
                  </p>
                  <CardTitle className="text-xl font-semibold">Últimas reproducciones</CardTitle>
                  <CardDescription>Mira quién reprodujo cada sonido por servidor.</CardDescription>
                </div>
                <Badge variant="muted">{filteredHistory.length} eventos</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {!filteredHistory.length && (
                  <p className="text-sm text-muted-foreground">
                    Todavía no hay reproducciones para este servidor.
                  </p>
                )}
                {filteredHistory.length > 0 && (
                  <ul className="space-y-3">
                    {paginatedHistory.map((entry) => (
                      <li
                        key={`${entry.at}-${entry.sound}`}
                        className="flex items-center gap-3 rounded-lg border border-border/70 bg-slate-900/60 px-3 py-3"
                      >
                        <Avatar className="h-10 w-10">
                          {avatarUrl(entry.user) ? (
                            <AvatarImage src={avatarUrl(entry.user)} alt={entry.user.username} />
                          ) : (
                            <AvatarFallback>
                              {entry.user.globalName?.[0] || entry.user.username?.[0] || '?'}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div className="flex flex-1 flex-col">
                          <p className="text-sm font-semibold">
                            {entry.user.globalName || entry.user.username}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            <SpeakerHigh
                              size={16}
                              weight="fill"
                              className="mr-1 inline align-middle text-primary"
                              aria-label="disparó"
                            />
                            <strong className="font-semibold">{entry.sound}</strong> · {historyLabel(entry)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {filteredHistory.length > HISTORY_PAGE_SIZE && (
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setHistoryPage(1)}
                      disabled={historyPage === 1}
                      aria-label="Primera página de historial"
                    >
                      <CaretDoubleLeft size={18} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={historyPage === 1}
                      aria-label="Página anterior de historial"
                    >
                      <CaretLeft size={18} />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Página {historyPage} de {historyTotalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                      disabled={historyPage === historyTotalPages}
                      aria-label="Página siguiente de historial"
                    >
                      <CaretRight size={18} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setHistoryPage(historyTotalPages)}
                      disabled={historyPage === historyTotalPages}
                      aria-label="Última página de historial"
                    >
                      <CaretDoubleRight size={18} />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
