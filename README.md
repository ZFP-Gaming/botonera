# Bot de Discord con `/join`

Bot sencillo en JavaScript que registra _slash commands_ `/join` (conectarse) y `/leave` (desconectarse) al canal de voz.

## Requisitos
- Node.js 18+
- Un bot creado en el [Portal de Desarrolladores de Discord](https://discord.com/developers/applications) con los intents de **Guilds** y **Guild Voice States** habilitados.
- Invitar el bot con permiso `CONNECT` y `SPEAK` en el servidor.

Configura estas variables de entorno antes de iniciar:
- `DISCORD_TOKEN`: token del bot.
- `DISCORD_CLIENT_ID`: ID de la aplicación/bot.
- `DISCORD_GUILD_ID`: ID del servidor donde quieres registrar el comando.

Puedes guardarlas en un `.env` y exportarlas en tu shell:

```bash
export DISCORD_TOKEN=tu_token
export DISCORD_CLIENT_ID=tu_client_id
export DISCORD_GUILD_ID=tu_guild_id
```

## Instalar dependencias
```bash
npm install
```

## Ejecutar
Inicia el bot (registra el comando en el servidor y luego conecta):
```bash
npm start
```

En tu servidor usa `/join` mientras estás en un canal de voz para que el bot entre, y `/leave` para sacarlo.
