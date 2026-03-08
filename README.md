# FNAF Max Mode Tracker

A personal tracker for FNAF Max Mode List completions. Fetches the list from [fnafmml.com](https://fnafmml.com)'s public API and stores your completions locally in your browser. **No data is submitted to their servers.**

## How to Run

1. **Local file**: Open `index.html` directly in your browser (e.g. double-click or `file:///path/to/index.html`).
2. **Local server** (recommended if you hit CORS): Run a simple HTTP server, e.g.:
   ```bash
   python3 -m http.server 8000
   ```
   Then open http://localhost:8000
3. **GitHub Pages**: Push to a repo and enable GitHub Pages; the app works as static files.

## Features

- **Main List (ML) and Unlimited List (UL)** – Switch between lists via tabs
- **Completion tracking** – Click a card to mark it complete; stored in `localStorage`
- **Progress** – Shows "X / Y completed" per list
- **Pagination** – Browse all pages (50 items per page)
- **Search** – Use the search box and press Enter to filter by title, game, or creator
- **MOTW badge** – Highlights the current Max Mode of the Week when set

## Data Source

Max mode data is fetched from the public API at [https://fnafmml.com/api](https://fnafmml.com/api-docs). All endpoints used are public and do not require authentication.

## License

MIT
