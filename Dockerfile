FROM node:22-slim

WORKDIR /app

ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && yt-dlp --version \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/src/index.js"]
