# ICEYE Task Visualizer

A zero-backend, client-side web application to evaluate, filter, and plan satellite SAR acquisition opportunities from **ICEYE** feasibility studies. Includes interactive geospatial visualization, Gantt scheduling, and stereo / cross-geometry pair analysis.

Link to the website: https://ricpedre.github.io/ICEYE-task-visualizer/[https://ricpedre.github.io/ICEYE-task-visualizer/]

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
