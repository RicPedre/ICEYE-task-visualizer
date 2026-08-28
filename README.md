# ICEYE Task Visualizer

A zero-backend, client-side web application to evaluate, filter, and plan satellite SAR acquisition opportunities from **ICEYE** feasibility studies. Includes interactive geospatial visualization, Gantt scheduling, and InSAR baseline / cross-geometry pair analysis.

---

## 🚀 Live Demo / GitHub Pages Setup

This application is **100% static client-side** (HTML5, Vanilla JavaScript, CSS3, Leaflet, Turf.js, SheetJS). It requires **no backend server or build process**.

### Steps to Host on GitHub Pages:

1. **Push this repository to GitHub**:
   ```bash
   git add .
   git commit -m "Deploy ICEYE Task Visualizer"
   git push origin main
   ```

2. **Enable GitHub Pages**:
   * Open your repository on [GitHub](https://github.com).
   * Go to **Settings** > **Pages** (in the left sidebar).
   * Under **Build and deployment** > **Source**, select **`Deploy from a branch`**.
   * Under **Branch**, select **`main`** and folder **`/ (root)`**.
   * Click **Save**.

3. **Open your Live App**:
   * Within 1–2 minutes, GitHub will publish your site at:
     `https://<your-username>.github.io/<repo-name>/`

---

## 🛰️ Key Features

- **📂 Client-Side Ingestion (Zero Upload to Servers)**:
  - Drag and drop `.xlsx` / `.xml` feasibility reports and optional `.kml` polygon / AOI files directly into the browser.
  - Data is processed 100% locally in your browser memory via SheetJS and DOMParser.

- **🗺️ Interactive Map Footprints (Leaflet + Turf.js)**:
  - Swath polygons color-coded by Pass & Look direction.
  - Multi-base map options (Satellite Imagery, Topographic, Dark theme).

- **📅 Gantt Acquisition Schedule**:
  - Chronological schedule with sticky date headers and smooth vertical scrolling.

- **🔗 Look Angle & Opposite-Pass Network Analysis (Tab 2)**:
  - Opposite-geometry pairing:
    - 🔵 **Ascending Left ↔ Descending Right** (West-looking)
    - 🟡 **Descending Left ↔ Ascending Right** (East-looking)
  - Pairing modes: *Strict Chain*, *Max Time Window* ($\Delta t$), and *Monitoring Network* ($<12\text{h}$ resolution).
  - Vector SVG baseline network chart with line labels ($\Delta t$, look delta, shared area).
  - Paired network export to **Excel (.xlsx)** and **CSV**.

- **⚡ Multi-Criteria Filtering**:
  - Orbit Pass & Look direction combinations.
  - Quick Presets: *West Looking*, *East Looking*, *Look Angle ≥ 30°*, *100% Coverage*.
