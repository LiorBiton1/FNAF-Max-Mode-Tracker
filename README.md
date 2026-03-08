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
- **Completion tracking** – Click a card to mark it complete
- **Guest mode** – Completions stored in browser localStorage
- **Login / Register** – Create an account to sync completions to the database (SQLite)
- **Progress** – Shows "X / Y completed" per list
- **Dynamic search** – Results update as you type
- **MOTW badge** – Highlights the current Max Mode of the Week when set

## Data Source

Max mode data is fetched from the public API at [https://fnafmml.com/api](https://fnafmml.com/api-docs). All endpoints used are public and do not require authentication.

## License

MIT
