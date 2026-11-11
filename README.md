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
- DM Jibboo `summary`: privately catch up on the last 150 messages or last 24 hours of `#social-chat`, whichever includes more messages, including readable text and context from attached/embedded images and memes.
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

- Node.js `26.13.0+` (the project version is recorded in `.node-version`)
- npm `12.2.2+`
- A maintained FFmpeg build (this local installation uses the FFmpeg 9.0 release branch)
- Docker + Docker Compose (for containerized run)
- Discord bot application in your server
- YouTube Data API key
- Gemini API key

Local npm installs include `yt-dlp`. Install a maintained [FFmpeg build](https://ffmpeg.org/download.html) separately and set `FFMPEG_PATH` to its executable, or make `ffmpeg` available on `PATH`. The bot no longer installs `ffmpeg-static`, whose bundled Linux FFmpeg 7.0.2 predates subsequent [security fixes](https://ffmpeg.org/security.html).

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
- `SUMMARY_CHANNEL_ID` (optional, defaults to `1375870076753809448`, the `#social-chat` channel)
- `YOUTUBE_API_KEY` (required)
- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, default `gemini-2.5-flash`)
- `WATCH_TOGETHER_APPLICATION_ID` (optional)
- `YTDLP_AUTO_UPDATE` (optional, default `1`; set to `0` to skip the Docker startup yt-dlp update check)
- `YTDLP_PATH` (optional, override yt-dlp executable path)
- `FFMPEG_PATH` (optional, absolute path to a maintained FFmpeg executable; otherwise uses `ffmpeg` on `PATH`)
- `QUEUE_LIMIT` (optional, default `50`)
- `NO_LISTENER_GRACE_SECONDS` (optional, default `15`)

## Private catch-up summaries

Send Jibboo a direct message containing just `summary` (case-insensitive). Jibboo replies in that DM with a recap of the last 150 messages or the preceding 24 hours of the configured summary channel, whichever includes more messages. Quiet channels reach further back to include 150 messages; busy channels include every message from the last 24 hours. If fewer than 150 messages exist, all available messages are included. System messages do not count toward the 150-message minimum. The DM shows the covered time range and message count. Requests, acknowledgements, summaries, and errors stay in DMs. The requester must belong to the configured server and have **View Channel** and **Read Message History** permissions for the source channel.

Enable **Message Content Intent** under **Bot → Privileged Gateway Intents** in the [Discord Developer Portal](https://discord.com/developers/applications) before requesting summaries. Jibboo also needs **View Channel** and **Read Message History** in `#social-chat`. Channel history is fetched over REST; the bot only subscribes to DM message events. No slash-command registration or public message is needed to request a summary.

The bot fetches channel history in pages until it has covered both the last 24 hours and at least 150 messages, or has exhausted the available history, then batches the selected messages into Gemini requests before combining the recaps. It includes message text, reply references, embed text, links, and image context. It summarizes posts in the source channel itself; separate thread histories, video, and audio aren't transcribed.

The existing Gemini API key/model handles both the summary and image reading ([Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)). The bot sends fetched channel text and supported images to Gemini on demand; it does not persist transcripts or summaries. Image reading includes visible text (OCR) and visual meme context, and can be imperfect. Up to 40 of the most recent images are attempted per request, with a 2 MiB download limit per image. Downloads use Discord attachment/media proxy URLs only; static PNG, JPEG, WebP, HEIC, and HEIF responses are supported, including static GIF previews when Discord's proxy provides them. Unavailable, oversized, or unsupported images are skipped; if vision fails, the bot retries that portion as text. The DM reports image coverage so missing context is visible.

## Run (Docker)

```bash
docker compose up --build -d
```

Check logs:

```bash
docker logs -f jibboo
```

The Docker container checks for a newer `yt-dlp` binary on startup so YouTube playback fixes can be picked up without rebuilding the image. Set `YTDLP_AUTO_UPDATE=0` to disable this behavior.

Stop:

```bash
docker compose down
```

## Run (Local npm)

Use Node.js 26.13.0 and npm 12.2.2. Check the active versions with `node --version` and `npm --version` before installing dependencies.

```bash
npm ci
npm run build
npm run dev
```

Run `npm audit` to check both application and development dependencies for known vulnerabilities. Dependency upgrades must update `package-lock.json` so `npm ci` installs the reviewed versions.

npm 12 blocks dependency install scripts by default. `package.json` allows the reviewed versions of `esbuild` and `youtube-dl-exec` so local installs include the required binaries. After upgrading one of these packages, inspect `npm install-scripts ls` and its install scripts, then refresh that package's approval with `npm install-scripts approve <package>`.

## Notes

- If YouTube API quota is exhausted, Jibboo falls back to yt-dlp search.
- Spotify track links are matched to YouTube Music for playback; Spotify albums and playlists are not expanded.
- Suno queueing works through `/play` and `/playnext` with public Suno share/song URLs; it does not require a Suno API key.
- Slash commands are registered on startup for the configured guild.
