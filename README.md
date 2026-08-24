# Cubyz Model Hub

A self-hosted web application for browsing and publishing Cubyz model assets.

## Run locally

```sh
npm ci
SESSION_SECRET="replace-with-a-long-random-value" npm start
```

## Docker

```sh
cp .env.example .env
# Set SESSION_SECRET in .env
docker compose up --build -d
```

The SQLite database and uploaded assets are deliberately excluded from Git.
Back them up separately.

## Licence and branding

The source code is available under the [MIT License](LICENSE). The Ashframe
name and brand assets are excluded from that licence; see [BRAND.md](BRAND.md).
