# Jibboo

Discord music bot for "The Friend Zone".

Jibboo supports slash commands for queueing YouTube Music-biased tracks, Spotify track links, direct playable links, public Suno song links, queue control, Gemini-assisted guidance, and continuous autoplay by artist/genre.

## Features

- `/play <text-or-url>`: search YouTube Music or queue a supported link, then autoplay in voice.
- `/video <text-or-url>`: queue video result, post an embed, and play audio in voice.
- `/playnext <text-or-url>`: search YouTube Music or queue a supported link after the current track.
- `/playlist <artist-or-genre>`: enable endless compatible autoplay.
- `/playlist off`: disable autoplay.
- `/stop`: stop playback, disconnect from voice, clear current/upcoming tracks, and stop playlist autoplay.
- `/next`, `/previous`, `/remove <number>`, `/volume <0-100>`, `/nowplaying`.
- `/jibboo <instruction>`: Gemini-powered music/queue assistant.
- `/howdo`: quick usage guide (ephemeral).
- Embedded queue control panel with buttons and suggestion dropdown.
- Playback auto-stops when no human users remain in voice.
- Default volume for new queues is `20%`.

## Commands

Run commands in monitored channels, usually `#chat` and `#dj-jibboo`. Public bot responses and the queue control panel post only in `POST_CHANNEL_ID`.

- `/play <text-or-url>`
- `/video <text-or-url>`
- `/playnext <text-or-url>`
- `/playlist <artist-or-genre>`
- `/playlist off`
- `/next`
- `/previous`
- `/stop`
- `/remove <number>`
- `/volume <0-100>`
- `/nowplaying`
- `/jibboo <instruction>`
- `/howdo`

`/play` and `/playnext` accept normal search text, direct YouTube links such as `https://www.youtube.com/watch?v=...`, Spotify track links such as `https://open.spotify.com/track/...`, public Suno links such as `https://suno.com/song/...`, and other direct playable HTTP links supported by yt-dlp/ffmpeg.

## Requirements

- Node.js `22+`
- `npm`
- Docker + Docker Compose (for containerized run)
- Discord bot application in your server
- YouTube Data API key
- Gemini API key

Local npm installs include bundled `ffmpeg` and `yt-dlp` binaries for playback.

## Environment

Copy `.env.example` to `.env` and set values:

```bash
cp .env.example .env
```

Variables:

- `DISCORD_TOKEN` (required)
- `DISCORD_CLIENT_ID` (required)
- `DISCORD_GUILD_ID` (required)
- `CONTROL_CHANNEL_ID` (required, usually `#chat`)
- `POST_CHANNEL_ID` (optional, defaults to `CONTROL_CHANNEL_ID`; set to `#dj-jibboo` to keep bot output there)
- `MONITOR_CHANNEL_IDS` (optional comma-separated override; defaults to `CONTROL_CHANNEL_ID,POST_CHANNEL_ID`)
- `YOUTUBE_API_KEY` (required)
- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, default `gemini-2.5-flash`)
- `WATCH_TOGETHER_APPLICATION_ID` (optional)
- `YTDLP_COOKIES_PATH` (optional, for authenticated yt-dlp requests)
- `YTDLP_PATH` (optional, override yt-dlp executable path)
- `FFMPEG_PATH` (optional, override ffmpeg executable path)
- `QUEUE_LIMIT` (optional, default `50`)
- `NO_LISTENER_GRACE_SECONDS` (optional, default `15`)

## Run (Docker)

```bash
docker compose up --build -d
```

Check logs:

```bash
docker logs -f jibboo
```

Stop:

```bash
docker compose down
```

## Run (Local npm)

```bash
npm ci
npm run build
npm run dev
```

## Notes

- If YouTube API quota is exhausted, Jibboo falls back to yt-dlp search.
- Spotify track links are matched to YouTube Music for playback; Spotify albums and playlists are not expanded.
- Suno queueing works through `/play` and `/playnext` with public Suno share/song URLs; it does not require a Suno API key.
- Slash commands are registered on startup for the configured guild.
