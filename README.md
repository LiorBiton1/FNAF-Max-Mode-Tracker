# FNAF Max Mode Tracker

A personal tracker for FNAF Max Mode List completions. Fetches the list from [fnafmml.com](https://fnafmml.com)'s public API. **No data is submitted to their servers.** Completions can be stored locally (guest) or synced to a database (registered user).

## How to Run

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure** (optional): Copy `.env.example` to `.env` and set `JWT_SECRET` for production:
   ```bash
   cp .env.example .env
   ```
   Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

3. **Start the server:**
   ```bash
   npm start
   ```
   Open http://localhost:3000 (or the port in `.env`).

## Features

- **Main List (ML) and Unlimited List (UL)** – Switch between lists via tabs
- **Completed tab** – View all your completed challenges in the same card layout
- **Completion tracking** – Click a card to mark it complete
- **Guest mode** – Completions stored in browser localStorage
- **Login / Register** – Create an account to sync completions to the database (MongoDB)
- **Progress** – Shows "X / Y completed" per list
- **Dynamic search** – Results update as you type
- **MOTW badge** – Highlights the current Max Mode of the Week when set
- **List cache** – Maxmodes are cached in MongoDB; use "Refresh list" when fnafmml.com updates

## Data Source

Max mode data comes from [fnafmml.com](https://fnafmml.com)'s public API. On first run the server fetches both lists and stores them in MongoDB. Subsequent requests are served from the cache, avoiding repeated API calls. Use the **Refresh list** button to fetch the latest data when fnafmml updates their site.

## License

MIT
