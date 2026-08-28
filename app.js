/* ==========================================================================
   AETHEL-GIS // Acquisition Feasibility Visualizer Main JavaScript
   ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  // App State
  let data = null;
  let allOpportunities = [];
  let filteredOpportunities = [];
  let selectedIds = new Set();

  let map = null;
  let swathLayerGroup = L.layerGroup();
  let aoiLayerGroup = L.layerGroup();
  let intersectionLayerGroup = L.layerGroup();
  let leafletLayersMap = new Map(); // id -> L.Polygon

  let baseLayers = {};
  let currentBaseLayer = null;

  let activeFilters = {
    combos: new Set(['ASCENDING - LEFT', 'ASCENDING - RIGHT', 'DESCENDING - LEFT', 'DESCENDING - RIGHT']),
    startDate: '2026-08-23',
    endDate: '2026-09-05',
    lookMin: 15,
    lookMax: 40,
    covMin: 0,
    covMax: 100,
    ozaMax: 50,
    szaMode: 'ALL',
    searchQuery: ''
  };

  // Opposite-Type Network Settings
  let networkSettings = {
    enableNet1: true, // Asc Left <-> Desc Right
    enableNet2: true, // Desc Left <-> Asc Right
    mode: 'STRICT_CHAIN', // 'STRICT_CHAIN', 'TIME_WINDOW', or 'MONITORING_NETWORK'
    monitoringPref: 'HIGHEST_LOOK_ANGLE', // 'HIGHEST_LOOK_ANGLE' or 'LOWEST_TIME_DIFF'
    maxDays: 3,
    showLineLabels: false
  };

  let activeNetworkPairs = [];
  let selectedPair = null;
  let isolatedPair = null;

  // Initialize Application
  setupImportModalHandlers();
  await loadDataset();

  // On first launch / GitHub version, invite user to drag & drop files
  const savedCampaigns = getSavedCampaigns();
  if (Object.keys(savedCampaigns).length === 0) {
    const modalImport = document.getElementById('modal-import');
    if (modalImport) modalImport.style.display = 'flex';
  }

  // Fetch JSON Dataset or Load Saved Campaign
  async function loadDataset(campaignId = 'default') {
    try {
      if (campaignId !== 'default') {
        const saved = getSavedCampaigns();
        if (saved[campaignId]) {
          data = saved[campaignId];
        } else {
          campaignId = 'default';
        }
      }

      if (campaignId === 'default') {
        if (window.ACQUISITIONS_EMBEDDED_DATA) {
          data = window.ACQUISITIONS_EMBEDDED_DATA;
        } else {
          const response = await fetch('acquisitions_data.json?v=' + Date.now());
          if (!response.ok) throw new Error('Network response was not ok');
          data = await response.json();
        }
      }

      allOpportunities = data.opportunities;
      filteredOpportunities = [...allOpportunities];
      
      adaptUIForDataset(data);
      updateCampaignSelectDropdown(campaignId);

      if (!map) {
        initMap();
      } else {
        updateMapForDataset();
      }

      applyFilters();
      setupEventListeners();
    } catch (err) {
      console.error('Error loading dataset:', err);
      if (window.ACQUISITIONS_EMBEDDED_DATA) {
        data = window.ACQUISITIONS_EMBEDDED_DATA;
        allOpportunities = data.opportunities;
        filteredOpportunities = [...allOpportunities];
        adaptUIForDataset(data);
        if (!map) initMap(); else updateMapForDataset();
        applyFilters();
        setupEventListeners();
      } else {
        alert('Could not load acquisitions_data.json. Please ensure server.py or parse_data.py has run.');
      }
    }
  }

  // Adapt UI Controls for loaded dataset
  function adaptUIForDataset(data) {
    if (!data || !data.metadata) return;

    // Subtitle
    const subTitle = document.getElementById('brand-subtitle');
    if (subTitle) {
      subTitle.textContent = `Area of Interest: ${data.metadata.aoi_name || 'Campaign Region'}`;
    }

    // Combos
    if (data.metadata.pass_look_combos) {
      activeFilters.combos = new Set(data.metadata.pass_look_combos);
    }

    // Date range
    if (data.metadata.date_range) {
      activeFilters.startDate = data.metadata.date_range[0];
      activeFilters.endDate = data.metadata.date_range[1];
      const startEl = document.getElementById('date-start');
      const endEl = document.getElementById('date-end');
      const valBadge = document.getElementById('val-date-range');
      const kpiDate = document.getElementById('kpi-date-window');

      if (startEl && endEl) {
        startEl.value = activeFilters.startDate;
        endEl.value = activeFilters.endDate;
        startEl.min = activeFilters.startDate;
        startEl.max = activeFilters.endDate;
        endEl.min = activeFilters.startDate;
        endEl.max = activeFilters.endDate;
      }
      if (valBadge) valBadge.textContent = `${activeFilters.startDate} to ${activeFilters.endDate}`;
      if (kpiDate) kpiDate.textContent = `${activeFilters.startDate} - ${activeFilters.endDate}`;
    }

    // Look angle range
    if (data.metadata.incid_range) {
      const minL = Math.floor(data.metadata.incid_range[0]);
      const maxL = Math.ceil(data.metadata.incid_range[1]);
      activeFilters.lookMin = minL;
      activeFilters.lookMax = maxL;

      const numMin = document.getElementById('num-look-min');
      const numMax = document.getElementById('num-look-max');
      const slideMin = document.getElementById('slider-look-min');
      const slideMax = document.getElementById('slider-look-max');
      const valLook = document.getElementById('val-look');

      if (numMin && numMax && slideMin && slideMax) {
        numMin.min = slideMin.min = Math.floor(minL - 5);
        numMin.max = slideMin.max = Math.ceil(maxL + 5);
        numMax.min = slideMax.min = Math.floor(minL - 5);
        numMax.max = slideMax.max = Math.ceil(maxL + 5);
        numMin.value = slideMin.value = minL;
        numMax.value = slideMax.value = maxL;
      }
      if (valLook) valLook.textContent = `${minL}° - ${maxL}°`;
    }

    // OZA range
    if (data.metadata.oza_range) {
      const maxOza = Math.ceil(data.metadata.oza_range[1]);
      activeFilters.ozaMax = Math.max(45, maxOza + 5);
      const slideOza = document.getElementById('slider-oza-max');
      const lblOza = document.getElementById('lbl-oza-max');
      const valOza = document.getElementById('val-oza');
      if (slideOza) {
        slideOza.max = Math.max(50, maxOza + 10);
        slideOza.value = activeFilters.ozaMax;
      }
      if (lblOza) lblOza.textContent = `≤ ${activeFilters.ozaMax}.0°`;
      if (valOza) valOza.textContent = `0° - ${activeFilters.ozaMax}°`;
    }

    renderDateQuickBadges();
  }

  // Update map bounds & AOI layer for current dataset
  function updateMapForDataset() {
    if (!map || !data || !data.metadata) return;
    const bounds = data.metadata.bounds;
    if (bounds && bounds.min_lat && bounds.max_lat) {
      map.fitBounds([
        [bounds.min_lat, bounds.min_lon],
        [bounds.max_lat, bounds.max_lon]
      ], { padding: [20, 20] });
    }

    aoiLayerGroup.clearLayers();
    const hasAoi = data.metadata.has_custom_aoi && data.metadata.aoi_polygon && data.metadata.aoi_polygon.length > 0;
    const toggleAoiBtn = document.getElementById('toggle-aoi');
    if (toggleAoiBtn) {
      toggleAoiBtn.style.display = hasAoi ? 'inline-block' : 'none';
    }

    if (hasAoi) {
      const aoiCoords = data.metadata.aoi_polygon.map(pt => [pt[1], pt[0]]);
      const aoiPoly = L.polygon(aoiCoords, {
        color: '#06b6d4',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#06b6d4',
        fillOpacity: 0.08
      }).addTo(aoiLayerGroup);
      
      aoiPoly.bindTooltip("<b>Area of Interest (AOI): " + (data.metadata.aoi_name || 'Campaign Region') + "</b>", { sticky: true });
    }

    renderMapSwaths();
  }

  // Initialize Leaflet GIS Map
  function initMap() {
    const bounds = data.metadata.bounds;
    const centerLat = (bounds.min_lat + bounds.max_lat) / 2;
    const centerLon = (bounds.min_lon + bounds.max_lon) / 2;

    map = L.map('map', {
      center: [centerLat, centerLon],
      zoom: 12,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Base Tile Layers
    baseLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 18
    });

    baseLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19
    });

    baseLayers.topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'Map data: OpenStreetMap',
      maxZoom: 17
    });

    currentBaseLayer = baseLayers.satellite;
    currentBaseLayer.addTo(map);

    swathLayerGroup.addTo(map);
    aoiLayerGroup.addTo(map);
    intersectionLayerGroup.addTo(map);

    updateMapForDataset();
  }

  // Get combo color mapping
  function getComboColor(combo) {
    switch (combo) {
      case 'ASCENDING - LEFT': return '#06b6d4';
      case 'ASCENDING - RIGHT': return '#818cf8';
      case 'DESCENDING - LEFT': return '#f59e0b';
      case 'DESCENDING - RIGHT': return '#10b981';
      default: return '#9ca3af';
    }
  }

  // Render Swath Polygons on Leaflet Map
  function renderMapSwaths() {
    swathLayerGroup.clearLayers();
    leafletLayersMap.clear();

    const listToRender = isolatedPair 
      ? [isolatedPair.opp1, isolatedPair.opp2]
      : filteredOpportunities;

    listToRender.forEach(opp => {
      const coords = opp.coordinates.map(pt => [pt[1], pt[0]]);
      
      const isOppInIsolated = isolatedPair && (opp.id === isolatedPair.opp1.id || opp.id === isolatedPair.opp2.id);
      const isSelected = selectedIds.has(opp.id) || isOppInIsolated;
      const baseColor = getComboColor(opp.pass_look_combo);
      
      const strokeColor = isOppInIsolated ? baseColor : (isSelected ? '#f43f5e' : baseColor);
      const fillColor = baseColor;
      const weight = isSelected ? 3.5 : 1.5;
      const fillOpacity = isSelected ? 0.38 : 0.18;

      const poly = L.polygon(coords, {
        color: strokeColor,
        weight: weight,
        fillColor: fillColor,
        fillOpacity: fillOpacity
      });

      // Tooltip Card
      const tooltipContent = `
        <div style="font-family: Inter, sans-serif; font-size: 12px; line-height: 1.4;">
          <div style="font-weight: 700; color: #fff; margin-bottom: 2px;">
            Opportunity ID #${opp.id} (${opp.pass_look_combo})
          </div>
          <div><b>Date:</b> ${opp.date} (${new Date(opp.start).toUTCString().replace('GMT', 'UTC')})</div>
          <div><b>Sensor:</b> ${opp.sensor}</div>
          <div><b>Look Angle:</b> ${opp.look_angle}° | <b>Incidence:</b> ${opp.min_incid}° - ${opp.max_incid}°</div>
          <div><b>OZA:</b> ${opp.oza}° | <b>SZA:</b> ${opp.sza}°</div>
          <div><b>Coverage Area:</b> <span style="color: #22d3ee; font-weight:700;">${opp.area_covered_pct}%</span> (${opp.target_in_image_km2} km²)</div>
        </div>
      `;

      poly.bindTooltip(tooltipContent, { sticky: true });

      // Click Event
      poly.on('click', () => {
        toggleSelectOpportunity(opp.id);
      });

      poly.addTo(swathLayerGroup);
      leafletLayersMap.set(opp.id, poly);
    });
  }

  // Filter Engine
  function applyFilters() {
    filteredOpportunities = allOpportunities.filter(opp => {
      // 1. Pass & Look Combination filter
      if (!activeFilters.combos.has(opp.pass_look_combo)) {
        return false;
      }

      // 2. Date Range Filter
      if (opp.date < activeFilters.startDate || opp.date > activeFilters.endDate) {
        return false;
      }

      // 3. Look Angle Filter
      if (opp.look_angle < activeFilters.lookMin || opp.look_angle > activeFilters.lookMax) {
        return false;
      }

      // 4. Coverage % Filter
      if (opp.area_covered_pct < activeFilters.covMin || opp.area_covered_pct > activeFilters.covMax) {
        return false;
      }

      // 5. OZA Filter
      if (opp.oza > activeFilters.ozaMax) return false;

      // 6. SZA Daylight / Night filter
      if (activeFilters.szaMode === 'DAY' && opp.sza >= 85) return false;
      if (activeFilters.szaMode === 'NIGHT' && opp.sza < 85) return false;

      // 7. Search Query
      if (activeFilters.searchQuery) {
        const q = activeFilters.searchQuery.toLowerCase();
        const matches = opp.id.toString().includes(q) ||
                        opp.sensor.toLowerCase().includes(q) ||
                        opp.pass.toLowerCase().includes(q) ||
                        opp.pass_look_combo.toLowerCase().includes(q) ||
                        opp.date.includes(q);
        if (!matches) return false;
      }

      return true;
    });

    updateKPIs();
    renderMapSwaths();
    renderTable();
    renderGanttTimeline();
    renderNetworkChart();
  }

  // Update KPI counters
  function updateKPIs() {
    document.getElementById('kpi-total').textContent = allOpportunities.length;
    document.getElementById('kpi-filtered').textContent = filteredOpportunities.length;
    document.getElementById('kpi-selected').textContent = selectedIds.size;
    document.getElementById('table-count').textContent = filteredOpportunities.length;
    document.getElementById('compare-count').textContent = selectedIds.size;
    
    document.getElementById('kpi-date-window').textContent = `${activeFilters.startDate} to ${activeFilters.endDate}`;
    document.getElementById('val-date-range').textContent = `${activeFilters.startDate} to ${activeFilters.endDate}`;

    document.getElementById('btn-compare').disabled = selectedIds.size === 0;
    const btnClear = document.getElementById('btn-clear-selection');
    if (btnClear) btnClear.disabled = selectedIds.size === 0;
  }

  // Helper: Combo Badge CSS Class
  function getComboBadgeClass(combo) {
    switch (combo) {
      case 'ASCENDING - LEFT': return 'badge-combo-asc-left';
      case 'ASCENDING - RIGHT': return 'badge-combo-asc-right';
      case 'DESCENDING - LEFT': return 'badge-combo-desc-left';
      case 'DESCENDING - RIGHT': return 'badge-combo-desc-right';
      default: return 'badge-asc';
    }
  }

  // Render Table
  function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    filteredOpportunities.forEach(opp => {
      const tr = document.createElement('tr');
      const isSelected = selectedIds.has(opp.id);
      if (isSelected) tr.classList.add('selected');

      const badgeClass = getComboBadgeClass(opp.pass_look_combo);
      const symbol = opp.pass_look_combo.includes('LEFT') ? '◀' : '▶';

      const dateStr = new Date(opp.start).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';

      tr.innerHTML = `
        <td><input type="checkbox" class="chk-opp" data-id="${opp.id}" ${isSelected ? 'checked' : ''}></td>
        <td style="font-weight: 700; font-family: 'JetBrains Mono', monospace;">#${opp.id}</td>
        <td>${dateStr}</td>
        <td><span class="badge-pass ${badgeClass}">${symbol} ${opp.pass_look_combo}</span></td>
        <td>${opp.sensor}</td>
        <td style="font-family: 'JetBrains Mono', monospace;">${opp.min_incid}° - ${opp.max_incid}°</td>
        <td style="font-family: 'JetBrains Mono', monospace;">${opp.oza}°</td>
        <td style="font-family: 'JetBrains Mono', monospace;">${opp.sza}°</td>
        <td style="font-family: 'JetBrains Mono', monospace;">${opp.azimuth}°</td>
        <td style="font-weight: 700; color: ${opp.area_covered_pct >= 90 ? '#10b981' : '#f59e0b'};">${opp.area_covered_pct}%</td>
        <td>
          <button class="btn btn-zoom" data-id="${opp.id}" style="padding: 2px 8px; font-size: 0.75rem;">
            🔍 Locate
          </button>
        </td>
      `;

      // Table Checkbox handler
      const chk = tr.querySelector('.chk-opp');
      chk.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleSelectOpportunity(opp.id);
      });

      // Zoom button handler
      const btnZoom = tr.querySelector('.btn-zoom');
      btnZoom.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomToOpportunity(opp.id);
      });

      tr.addEventListener('click', () => {
        zoomToOpportunity(opp.id);
      });

      tbody.appendChild(tr);
    });
  }

  // Toggle selection state
  function toggleSelectOpportunity(id) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    updateKPIs();
    renderMapSwaths();
    renderTable();
    renderGanttTimeline();
    renderNetworkChart();
  }

  // Zoom map to opportunity
  function zoomToOpportunity(id) {
    const opp = allOpportunities.find(o => o.id === id);
    if (!opp) return;

    if (!selectedIds.has(id)) {
      selectedIds.add(id);
      updateKPIs();
      renderMapSwaths();
      renderTable();
      renderNetworkChart();
    }

    const coords = opp.coordinates.map(pt => [pt[1], pt[0]]);
    const poly = L.polygon(coords);
    map.fitBounds(poly.getBounds(), { padding: [50, 50], maxZoom: 14 });

    const layer = leafletLayersMap.get(id);
    if (layer) {
      layer.openTooltip();
    }
  }

  // Render Gantt Timeline
  function renderGanttTimeline() {
    const container = document.getElementById('gantt-container');
    container.innerHTML = '';

    if (filteredOpportunities.length === 0) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">No opportunities match the current filter criteria.</div>';
      return;
    }

    const tStart = new Date(activeFilters.startDate + 'T00:00:00Z').getTime();
    const tEnd = new Date(activeFilters.endDate + 'T23:59:59Z').getTime();
    const totalDuration = tEnd - tStart;

    const timelineWrapper = document.createElement('div');
    timelineWrapper.style.position = 'relative';
    timelineWrapper.style.minWidth = '100%';
    timelineWrapper.style.padding = '10px 0';

    // Day Header ticks
    const daysHeader = document.createElement('div');
    daysHeader.style.display = 'flex';
    daysHeader.style.borderBottom = '1px solid var(--border-light)';
    daysHeader.style.paddingBottom = '6px';
    daysHeader.style.marginBottom = '8px';
    daysHeader.style.position = 'sticky';
    daysHeader.style.top = '-10px';
    daysHeader.style.background = '#0d1320';
    daysHeader.style.zIndex = '10';
    daysHeader.style.height = '24px';

    const cur = new Date(tStart);
    while (cur.getTime() <= tEnd) {
      const dayPct = ((cur.getTime() - tStart) / totalDuration) * 100;
      const tick = document.createElement('span');
      tick.style.position = 'absolute';
      tick.style.left = `${dayPct}%`;
      tick.style.fontSize = '10px';
      tick.style.color = 'var(--text-dim)';
      tick.style.fontFamily = 'JetBrains Mono, monospace';
      tick.textContent = cur.toISOString().substring(5, 10);
      daysHeader.appendChild(tick);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    timelineWrapper.appendChild(daysHeader);

    // Render Opportunity Rows
    filteredOpportunities.forEach(opp => {
      const oppStart = new Date(opp.start).getTime();
      const leftPct = Math.max(0, Math.min(100, ((oppStart - tStart) / totalDuration) * 100));

      const isSelected = selectedIds.has(opp.id);
      const barColor = getComboColor(opp.pass_look_combo);

      const row = document.createElement('div');
      row.style.position = 'relative';
      row.style.height = '22px';
      row.style.margin = '3px 0';
      row.style.background = 'rgba(255,255,255,0.02)';
      row.style.borderRadius = '3px';

      const bar = document.createElement('div');
      bar.style.position = 'absolute';
      bar.style.left = `${leftPct}%`;
      bar.style.width = '14px';
      bar.style.height = '16px';
      bar.style.top = '3px';
      bar.style.background = isSelected ? '#f43f5e' : barColor;
      bar.style.borderRadius = '3px';
      bar.style.cursor = 'pointer';
      bar.style.boxShadow = isSelected ? '0 0 8px #f43f5e' : 'none';

      bar.title = `ID #${opp.id} | ${opp.pass_look_combo} | ${opp.sensor} | Incid: ${opp.min_incid}° | Cov: ${opp.area_covered_pct}%`;

      bar.addEventListener('click', () => {
        zoomToOpportunity(opp.id);
        toggleSelectOpportunity(opp.id);
      });

      row.appendChild(bar);

      const label = document.createElement('span');
      label.style.position = 'absolute';
      label.style.left = `calc(${leftPct}% + 18px)`;
      label.style.fontSize = '11px';
      label.style.color = 'var(--text-muted)';
      label.style.whiteSpace = 'nowrap';
      label.textContent = `#${opp.id} (${opp.pass_look_combo}) ${opp.look_angle}°`;
      row.appendChild(label);

      timelineWrapper.appendChild(row);
    });

    container.appendChild(timelineWrapper);
  }

  // ==========================================================================
  // LOOK ANGLE VS DATE NETWORK ENGINE & PAIR COMPUTATION
  // ==========================================================================

  // Compute Footprint Intersection Area via Turf.js
  function computeSharedArea(oppA, oppB) {
    try {
      if (!oppA.coordinates || !oppB.coordinates || typeof turf === 'undefined') return 0;
      
      const ringA = oppA.coordinates.map(p => [p[0], p[1]]);
      if (ringA[0][0] !== ringA[ringA.length - 1][0] || ringA[0][1] !== ringA[ringA.length - 1][1]) {
        ringA.push([ringA[0][0], ringA[0][1]]);
      }
      
      const ringB = oppB.coordinates.map(p => [p[0], p[1]]);
      if (ringB[0][0] !== ringB[ringB.length - 1][0] || ringB[0][1] !== ringB[ringB.length - 1][1]) {
        ringB.push([ringB[0][0], ringB[0][1]]);
      }

      const polyA = turf.polygon([ringA]);
      const polyB = turf.polygon([ringB]);
      const intersection = turf.intersect(polyA, polyB);
      
      if (!intersection) return 0;
      const areaSqM = turf.area(intersection);
      return areaSqM / 1e6; // km²
    } catch (err) {
      console.warn('Intersection calc error:', err);
      return 0;
    }
  }

  // Helper: Build Monitoring Network Pairs with Target-Side Bottleneck Resolution
  function buildMonitoringPairs(netItems, netId, netName, lineColor) {
    const tentativePairs = [];

    for (let i = 0; i < netItems.length; i++) {
      const a = netItems[i];
      const tA = new Date(a.start).getTime();

      const candidates = [];
      for (let j = i + 1; j < netItems.length; j++) {
        const b = netItems[j];
        if (a.pass_look_combo !== b.pass_look_combo) {
          const tB = new Date(b.start).getTime();
          const dt_hours = (tB - tA) / (1000 * 3600);
          const mean_look = (a.look_angle + b.look_angle) / 2;
          candidates.push({
            opp1: a,
            opp2: b,
            t1: tA,
            t2: tB,
            dt_hours: dt_hours,
            dt_days: dt_hours / 24,
            look_diff: Math.abs(b.look_angle - a.look_angle),
            mean_look: mean_look
          });
        }
      }

      if (candidates.length === 0) continue;

      const under12h = candidates.filter(c => c.dt_hours <= 12);

      let bestCand = null;
      if (under12h.length > 0) {
        if (networkSettings.monitoringPref === 'HIGHEST_LOOK_ANGLE') {
          under12h.sort((x, y) => y.mean_look - x.mean_look || x.dt_hours - y.dt_hours);
        } else {
          under12h.sort((x, y) => x.dt_hours - y.dt_hours || y.mean_look - x.mean_look);
        }
        bestCand = under12h[0];
      } else {
        candidates.sort((x, y) => x.dt_hours - y.dt_hours || y.mean_look - x.mean_look);
        bestCand = candidates[0];
      }

      if (bestCand) {
        tentativePairs.push({
          networkId: netId,
          networkName: netName,
          lineColor: lineColor,
          opp1: bestCand.opp1,
          opp2: bestCand.opp2,
          t1: bestCand.t1,
          t2: bestCand.t2,
          dt_hours: bestCand.dt_hours,
          dt_days: bestCand.dt_days,
          look_diff: bestCand.look_diff,
          mean_look: bestCand.mean_look,
          isUnder12h: bestCand.dt_hours <= 12,
          shared_area_km2: computeSharedArea(bestCand.opp1, bestCand.opp2)
        });
      }
    }

    const groupedByTarget = new Map();
    tentativePairs.forEach(pair => {
      const targetId = pair.opp2.id;
      if (!groupedByTarget.has(targetId)) {
        groupedByTarget.set(targetId, []);
      }
      groupedByTarget.get(targetId).push(pair);
    });

    const finalPairs = [];
    groupedByTarget.forEach((competingPairs) => {
      if (competingPairs.length === 1) {
        finalPairs.push(competingPairs[0]);
      } else {
        competingPairs.sort((p1, p2) => {
          if (p1.isUnder12h !== p2.isUnder12h) {
            return p1.isUnder12h ? -1 : 1;
          }
          if (p1.isUnder12h) {
            if (networkSettings.monitoringPref === 'HIGHEST_LOOK_ANGLE') {
              return p2.mean_look - p1.mean_look || p1.dt_hours - p2.dt_hours;
            } else {
              return p1.dt_hours - p2.dt_hours || p2.mean_look - p1.mean_look;
            }
          } else {
            return p1.dt_hours - p2.dt_hours || p2.mean_look - p1.mean_look;
          }
        });
        finalPairs.push(competingPairs[0]);
      }
    });

    return finalPairs.sort((p1, p2) => p1.t1 - p2.t1);
  }

  // Calculate pairs for Network 1 & Network 2
  function computeNetworkPairs() {
    const pairs = [];
    const maxTimeMs = networkSettings.maxDays * 86400000;

    // Network 1: Ascending Left (Look West) <-> Descending Right (Look West)
    if (networkSettings.enableNet1) {
      const net1Items = filteredOpportunities.filter(o => 
        o.pass_look_combo === 'ASCENDING - LEFT' || o.pass_look_combo === 'DESCENDING - RIGHT'
      ).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

      if (networkSettings.mode === 'MONITORING_NETWORK') {
        const net1Pairs = buildMonitoringPairs(net1Items, 1, 'Ascending Left ↔ Descending Right', '#06b6d4');
        pairs.push(...net1Pairs);
      } else if (networkSettings.mode === 'STRICT_CHAIN') {
        // Connect EACH acquisition to its NEXT valid subsequent acquisition of opposite type
        for (let i = 0; i < net1Items.length; i++) {
          const a = net1Items[i];
          for (let j = i + 1; j < net1Items.length; j++) {
            const b = net1Items[j];
            if (a.pass_look_combo !== b.pass_look_combo) {
              const tA = new Date(a.start).getTime();
              const tB = new Date(b.start).getTime();
              const dt_hours = (tB - tA) / (1000 * 3600);
              pairs.push({
                networkId: 1,
                networkName: 'Ascending Left ↔ Descending Right',
                lineColor: '#06b6d4',
                opp1: a,
                opp2: b,
                t1: tA,
                t2: tB,
                dt_hours: dt_hours,
                dt_days: dt_hours / 24,
                look_diff: Math.abs(b.look_angle - a.look_angle),
                shared_area_km2: computeSharedArea(a, b)
              });
              break; // Found next valid opposite acquisition
            }
          }
        }
      } else {
        // TIME_WINDOW mode: all opposite pairs within maxDays
        for (let i = 0; i < net1Items.length; i++) {
          const a = net1Items[i];
          const tA = new Date(a.start).getTime();
          for (let j = i + 1; j < net1Items.length; j++) {
            const b = net1Items[j];
            const tB = new Date(b.start).getTime();
            if (tB - tA > maxTimeMs) break;
            if (a.pass_look_combo !== b.pass_look_combo) {
              const dt_hours = (tB - tA) / (1000 * 3600);
              pairs.push({
                networkId: 1,
                networkName: 'Ascending Left ↔ Descending Right',
                lineColor: '#06b6d4',
                opp1: a,
                opp2: b,
                t1: tA,
                t2: tB,
                dt_hours: dt_hours,
                dt_days: dt_hours / 24,
                look_diff: Math.abs(b.look_angle - a.look_angle),
                shared_area_km2: computeSharedArea(a, b)
              });
            }
          }
        }
      }
    }

    // Network 2: Descending Left (Look East) <-> Ascending Right (Look East)
    if (networkSettings.enableNet2) {
      const net2Items = filteredOpportunities.filter(o => 
        o.pass_look_combo === 'DESCENDING - LEFT' || o.pass_look_combo === 'ASCENDING - RIGHT'
      ).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

      if (networkSettings.mode === 'MONITORING_NETWORK') {
        const net2Pairs = buildMonitoringPairs(net2Items, 2, 'Descending Left ↔ Ascending Right', '#f59e0b');
        pairs.push(...net2Pairs);
      } else if (networkSettings.mode === 'STRICT_CHAIN') {
        // Connect EACH acquisition to its NEXT valid subsequent acquisition of opposite type
        for (let i = 0; i < net2Items.length; i++) {
          const a = net2Items[i];
          for (let j = i + 1; j < net2Items.length; j++) {
            const b = net2Items[j];
            if (a.pass_look_combo !== b.pass_look_combo) {
              const tA = new Date(a.start).getTime();
              const tB = new Date(b.start).getTime();
              const dt_hours = (tB - tA) / (1000 * 3600);
              pairs.push({
                networkId: 2,
                networkName: 'Descending Left ↔ Ascending Right',
                lineColor: '#f59e0b',
                opp1: a,
                opp2: b,
                t1: tA,
                t2: tB,
                dt_hours: dt_hours,
                dt_days: dt_hours / 24,
                look_diff: Math.abs(b.look_angle - a.look_angle),
                shared_area_km2: computeSharedArea(a, b)
              });
              break; // Found next valid opposite acquisition
            }
          }
        }
      } else {
        // TIME_WINDOW mode: all opposite pairs within maxDays
        for (let i = 0; i < net2Items.length; i++) {
          const a = net2Items[i];
          const tA = new Date(a.start).getTime();
          for (let j = i + 1; j < net2Items.length; j++) {
            const b = net2Items[j];
            const tB = new Date(b.start).getTime();
            if (tB - tA > maxTimeMs) break;
            if (a.pass_look_combo !== b.pass_look_combo) {
              const dt_hours = (tB - tA) / (1000 * 3600);
              pairs.push({
                networkId: 2,
                networkName: 'Descending Left ↔ Ascending Right',
                lineColor: '#f59e0b',
                opp1: a,
                opp2: b,
                t1: tA,
                t2: tB,
                dt_hours: dt_hours,
                dt_days: dt_hours / 24,
                look_diff: Math.abs(b.look_angle - a.look_angle),
                shared_area_km2: computeSharedArea(a, b)
              });
            }
          }
        }
      }
    }

    return pairs;
  }

  // Floating Tooltip Helpers
  function showChartTooltip(html, e) {
    const tip = document.getElementById('chart-floating-tooltip');
    if (!tip) return;
    tip.innerHTML = html;
    tip.style.display = 'block';
    moveChartTooltip(e);
  }

  function moveChartTooltip(e) {
    const tip = document.getElementById('chart-floating-tooltip');
    if (!tip || tip.style.display === 'none') return;
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;

    if (x + 280 > window.innerWidth) {
      x = e.clientX - 285;
    }
    if (y + 140 > window.innerHeight) {
      y = e.clientY - 140;
    }
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function hideChartTooltip() {
    const tip = document.getElementById('chart-floating-tooltip');
    if (tip) tip.style.display = 'none';
  }

  // Render Look Angle vs Date Vector SVG Network Chart
  function renderNetworkChart() {
    const wrapper = document.getElementById('network-svg-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    hideChartTooltip();

    activeNetworkPairs = computeNetworkPairs();

    // Update Counts in toolbar
    const count1 = activeNetworkPairs.filter(p => p.networkId === 1).length;
    const count2 = activeNetworkPairs.filter(p => p.networkId === 2).length;
    const countEl1 = document.getElementById('count-net-1');
    const countEl2 = document.getElementById('count-net-2');
    if (countEl1) countEl1.textContent = `${count1} pairs`;
    if (countEl2) countEl2.textContent = `${count2} pairs`;

    // Update Time Gap Stats (Max & Mean Δt)
    const statMaxLapse = document.getElementById('stat-max-lapse');
    const statMeanLapse = document.getElementById('stat-mean-lapse');

    if (activeNetworkPairs.length > 0) {
      const dtList = activeNetworkPairs.map(p => p.dt_hours);
      const maxDtHours = Math.max(...dtList);
      const meanDtHours = dtList.reduce((sum, v) => sum + v, 0) / dtList.length;

      const maxDtDays = maxDtHours / 24;
      const meanDtDays = meanDtHours / 24;

      if (statMaxLapse) {
        statMaxLapse.textContent = `Max Δt: ${maxDtHours.toFixed(1)}h (${maxDtDays.toFixed(1)}d)`;
      }
      if (statMeanLapse) {
        statMeanLapse.textContent = `Mean Δt: ${meanDtHours.toFixed(1)}h (${meanDtDays.toFixed(1)}d)`;
      }
    } else {
      if (statMaxLapse) statMaxLapse.textContent = 'Max Δt: --';
      if (statMeanLapse) statMeanLapse.textContent = 'Mean Δt: --';
    }

    const width = wrapper.clientWidth || 920;
    const height = wrapper.clientHeight || 200;

    const margin = { top: 16, right: 36, bottom: 44, left: 52 };
    const plotWidth = Math.max(100, width - margin.left - margin.right);
    const plotHeight = Math.max(80, height - margin.top - margin.bottom);

    // Time Axis Scale
    const tStart = new Date(activeFilters.startDate + 'T00:00:00Z').getTime();
    const tEnd = new Date(activeFilters.endDate + 'T23:59:59Z').getTime();
    const timeSpan = Math.max(1, tEnd - tStart);

    function getX(timestamp) {
      return margin.left + ((timestamp - tStart) / timeSpan) * plotWidth;
    }

    // Look Angle Y Axis Scale (18° to 33° default)
    let minLook = 18;
    let maxLook = 33;
    if (filteredOpportunities.length > 0) {
      const looks = filteredOpportunities.map(o => o.look_angle);
      minLook = Math.min(18, Math.floor(Math.min(...looks)));
      maxLook = Math.max(32.5, Math.ceil(Math.max(...looks)));
    }
    const lookSpan = Math.max(1, maxLook - minLook);

    function getY(lookAngle) {
      return margin.top + plotHeight - ((lookAngle - minLook) / lookSpan) * plotHeight;
    }

    // Create SVG element
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");

    // Background & Outer border
    const bgRect = document.createElementNS(svgNS, "rect");
    bgRect.setAttribute("x", margin.left);
    bgRect.setAttribute("y", margin.top);
    bgRect.setAttribute("width", plotWidth);
    bgRect.setAttribute("height", plotHeight);
    bgRect.setAttribute("fill", "#ffffff");
    bgRect.setAttribute("stroke", "#cbd5e1");
    bgRect.setAttribute("stroke-width", "1.2");
    svg.appendChild(bgRect);

    // Grid Group
    const gridGroup = document.createElementNS(svgNS, "g");
    gridGroup.setAttribute("class", "chart-grid");
    svg.appendChild(gridGroup);

    // Horizontal Y Grid Lines & Ticks (Every 2° or 4°)
    const yStep = (maxLook - minLook) > 10 ? 4 : 2;
    for (let l = Math.ceil(minLook); l <= Math.floor(maxLook); l += yStep) {
      const yPos = getY(l);

      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", margin.left);
      line.setAttribute("x2", margin.left + plotWidth);
      line.setAttribute("y1", yPos);
      line.setAttribute("y2", yPos);
      line.setAttribute("stroke", "#e2e8f0");
      line.setAttribute("stroke-width", "1");
      gridGroup.appendChild(line);

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", margin.left - 8);
      text.setAttribute("y", yPos + 4);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("font-size", "11");
      text.setAttribute("font-weight", "500");
      text.setAttribute("fill", "#64748b");
      text.textContent = `${l}`;
      svg.appendChild(text);
    }

    // Vertical X Grid Lines & Date Ticks
    const curDate = new Date(tStart);
    while (curDate.getTime() <= tEnd) {
      const xPos = getX(curDate.getTime() + 12 * 3600 * 1000); // midday
      
      const vLine = document.createElementNS(svgNS, "line");
      vLine.setAttribute("x1", xPos);
      vLine.setAttribute("x2", xPos);
      vLine.setAttribute("y1", margin.top);
      vLine.setAttribute("y2", margin.top + plotHeight);
      vLine.setAttribute("stroke", "#e2e8f0");
      vLine.setAttribute("stroke-width", "1");
      gridGroup.appendChild(vLine);

      // Date Label dd-mm
      const dayStr = String(curDate.getUTCDate()).padStart(2, '0');
      const monStr = String(curDate.getUTCMonth() + 1).padStart(2, '0');
      const dateLabel = `${dayStr}-${monStr}`;

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", xPos);
      text.setAttribute("y", margin.top + plotHeight + 16);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "10");
      text.setAttribute("font-weight", "500");
      text.setAttribute("font-family", "JetBrains Mono, monospace");
      text.setAttribute("fill", "#64748b");
      text.textContent = dateLabel;
      svg.appendChild(text);

      curDate.setUTCDate(curDate.getUTCDate() + 2); // every 2 days
    }

    // Y Axis Title: Look Angle [°]
    const yTitle = document.createElementNS(svgNS, "text");
    yTitle.setAttribute("transform", `rotate(-90)`);
    yTitle.setAttribute("x", -(margin.top + plotHeight / 2));
    yTitle.setAttribute("y", 16);
    yTitle.setAttribute("text-anchor", "middle");
    yTitle.setAttribute("font-size", "12");
    yTitle.setAttribute("font-weight", "700");
    yTitle.setAttribute("fill", "#1e293b");
    yTitle.textContent = "Look Angle [°]";
    svg.appendChild(yTitle);

    // X Axis Title: Acquisition Date [dd-mm]
    const xTitle = document.createElementNS(svgNS, "text");
    xTitle.setAttribute("x", margin.left + plotWidth / 2);
    xTitle.setAttribute("y", height - 4);
    xTitle.setAttribute("text-anchor", "middle");
    xTitle.setAttribute("font-size", "11");
    xTitle.setAttribute("font-weight", "700");
    xTitle.setAttribute("fill", "#1e293b");
    xTitle.textContent = "Acquisition Date [dd-mm]";
    svg.appendChild(xTitle);

    // Group for Network Lines
    const linesGroup = document.createElementNS(svgNS, "g");
    linesGroup.setAttribute("class", "network-lines");
    svg.appendChild(linesGroup);

    // Render Network Lines
    activeNetworkPairs.forEach(pair => {
      const x1 = getX(pair.t1);
      const y1 = getY(pair.opp1.look_angle);
      const x2 = getX(pair.t2);
      const y2 = getY(pair.opp2.look_angle);

      const isThisPairIsolated = isolatedPair && (
        (isolatedPair.opp1.id === pair.opp1.id && isolatedPair.opp2.id === pair.opp2.id) ||
        (isolatedPair.opp1.id === pair.opp2.id && isolatedPair.opp2.id === pair.opp1.id)
      );
      const isDimmed = isolatedPair && !isThisPairIsolated;

      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", isThisPairIsolated ? "#f43f5e" : pair.lineColor);
      line.setAttribute("stroke-width", isThisPairIsolated ? "4" : "2");
      if (pair.networkId === 2) {
        line.setAttribute("stroke-dasharray", "4, 3");
      }
      line.setAttribute("opacity", isDimmed ? "0.12" : (isThisPairIsolated ? "1" : "0.85"));
      line.setAttribute("class", `net-link-line ${isThisPairIsolated ? 'isolated-focus' : ''}`);

      // Line Hover Events
      line.addEventListener('mouseenter', (e) => {
        const html = `
          <div class="chart-floating-tooltip-title">${pair.networkName}</div>
          <div><b>Pair:</b> #${pair.opp1.id} ↔ #${pair.opp2.id}</div>
          <div><b>Time Distance (Δt):</b> ${pair.dt_days.toFixed(2)} days (${pair.dt_hours.toFixed(1)}h)</div>
          <div><b>Look Angle Diff (|Δθ|):</b> ${pair.look_diff.toFixed(2)}°</div>
          <div><b>Shared Footprint Area:</b> <span style="color:#38bdf8;font-weight:700;">${pair.shared_area_km2.toFixed(2)} km²</span></div>
          <div style="font-size:0.7rem;color:#94a3b8;margin-top:4px;">Click to isolate pair &amp; visualize footprints</div>
        `;
        showChartTooltip(html, e);
      });
      line.addEventListener('mousemove', moveChartTooltip);
      line.addEventListener('mouseleave', hideChartTooltip);

      // Line Click Interaction -> Isolate Pair
      line.addEventListener('click', (e) => {
        e.stopPropagation();
        hideChartTooltip();
        openPairInspector(pair);
      });

      linesGroup.appendChild(line);

      // Optional On-Line Badges
      if (networkSettings.showLineLabels && !isDimmed) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;

        const badgeRect = document.createElementNS(svgNS, "rect");
        badgeRect.setAttribute("x", mx - 38);
        badgeRect.setAttribute("y", my - 9);
        badgeRect.setAttribute("width", 76);
        badgeRect.setAttribute("height", 18);
        badgeRect.setAttribute("rx", 3);
        badgeRect.setAttribute("fill", "rgba(15, 23, 42, 0.85)");
        badgeRect.setAttribute("stroke", pair.lineColor);
        badgeRect.setAttribute("stroke-width", "1");
        linesGroup.appendChild(badgeRect);

        const badgeText = document.createElementNS(svgNS, "text");
        badgeText.setAttribute("x", mx);
        badgeText.setAttribute("y", my + 3);
        badgeText.setAttribute("text-anchor", "middle");
        badgeText.setAttribute("font-size", "9");
        badgeText.setAttribute("font-weight", "600");
        badgeText.setAttribute("fill", "#ffffff");
        badgeText.textContent = `Δt:${pair.dt_days.toFixed(1)}d | ${pair.shared_area_km2.toFixed(1)}k`;
        linesGroup.appendChild(badgeText);
      }
    });

    // Group for Markers
    const markersGroup = document.createElementNS(svgNS, "g");
    markersGroup.setAttribute("class", "network-nodes");
    svg.appendChild(markersGroup);

    // Render Opportunity Directional Triangle Markers
    filteredOpportunities.forEach(opp => {
      const cx = getX(new Date(opp.start).getTime());
      const cy = getY(opp.look_angle);
      
      const isOppInIsolated = isolatedPair && (opp.id === isolatedPair.opp1.id || opp.id === isolatedPair.opp2.id);
      const isDimmed = isolatedPair && !isOppInIsolated;
      const isSelected = selectedIds.has(opp.id) || isOppInIsolated;

      const isLeft = opp.pass_look_combo.includes('LEFT');
      const color = getComboColor(opp.pass_look_combo);

      // Directional Triangle: ◀ Left vs ▶ Right
      const poly = document.createElementNS(svgNS, "polygon");
      if (isLeft) {
        // Pointing Left ◀
        poly.setAttribute("points", `${cx + 7},${cy - 6.5} ${cx - 7},${cy} ${cx + 7},${cy + 6.5}`);
      } else {
        // Pointing Right ▶
        poly.setAttribute("points", `${cx - 7},${cy - 6.5} ${cx + 7},${cy} ${cx - 7},${cy + 6.5}`);
      }

      poly.setAttribute("fill", color);
      poly.setAttribute("stroke", isSelected ? "#f43f5e" : "#1f2937");
      poly.setAttribute("stroke-width", isSelected ? "3" : "1.2");
      poly.setAttribute("opacity", isDimmed ? "0.18" : "1");
      poly.setAttribute("class", `net-node-marker ${isSelected ? 'selected' : ''}`);

      // Smooth, Glitch-Free Hover Tooltip
      poly.addEventListener('mouseenter', (e) => {
        const symbol = opp.pass_look_combo.includes('LEFT') ? '◀' : '▶';
        const html = `
          <div class="chart-floating-tooltip-title">Opportunity #${opp.id}</div>
          <div><b>Combo:</b> ${symbol} ${opp.pass_look_combo}</div>
          <div><b>Look Angle:</b> <span style="color:#f59e0b;font-weight:700;">${opp.look_angle}°</span></div>
          <div><b>Date:</b> ${opp.date} (${new Date(opp.start).toUTCString().substring(17, 22)} UTC)</div>
          <div><b>Sensor Mode:</b> ${opp.sensor}</div>
          <div><b>Target Coverage:</b> <span style="color:#10b981;font-weight:700;">${opp.area_covered_pct}%</span> (${opp.target_in_image_km2} km²)</div>
          <div><b>Incidence Angle:</b> ${opp.min_incid}° - ${opp.max_incid}°</div>
          <div style="font-size:0.7rem;color:#94a3b8;margin-top:4px;">Click to locate on map &amp; select in table</div>
        `;
        showChartTooltip(html, e);
      });
      poly.addEventListener('mousemove', moveChartTooltip);
      poly.addEventListener('mouseleave', hideChartTooltip);

      poly.addEventListener('click', (e) => {
        e.stopPropagation();
        hideChartTooltip();
        zoomToOpportunity(opp.id);
        toggleSelectOpportunity(opp.id);
      });

      markersGroup.appendChild(poly);
    });

    // Clicking Empty Background Resets Isolation
    svg.addEventListener('click', (e) => {
      if (isolatedPair && (e.target === svg || e.target.classList.contains('grid-line'))) {
        restoreAllFromIsolation();
      }
    });

    wrapper.appendChild(svg);
  }

  // Open Inspector Card for a Selected Pair & Isolate on Map & Chart
  function openPairInspector(pair) {
    isolatedPair = pair;
    selectedPair = pair;
    const card = document.getElementById('network-inspector');
    const title = document.getElementById('inspector-title');
    const content = document.getElementById('inspector-content');
    if (!card || !content) return;

    title.textContent = `${pair.networkName}`;
    content.innerHTML = `
      <div style="font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">
        Pair: <span style="color:#38bdf8;">#${pair.opp1.id}</span> (${pair.opp1.pass_look_combo}) ↔ <span style="color:#f59e0b;">#${pair.opp2.id}</span> (${pair.opp2.pass_look_combo})
      </div>
      <div class="inspector-metric-grid">
        <div class="inspector-metric-box">
          <span class="inspector-metric-label">Time Distance (Δt)</span>
          <span class="inspector-metric-val">${pair.dt_days.toFixed(2)} days <span style="font-size:0.72rem;color:#94a3b8;">(${pair.dt_hours.toFixed(1)}h)</span></span>
        </div>
        <div class="inspector-metric-box">
          <span class="inspector-metric-label">Shared Footprint Area</span>
          <span class="inspector-metric-val">${pair.shared_area_km2.toFixed(2)} km²</span>
        </div>
        <div class="inspector-metric-box">
          <span class="inspector-metric-label">Look Angle Difference</span>
          <span class="inspector-metric-val">${pair.look_diff.toFixed(2)}°</span>
        </div>
        <div class="inspector-metric-box">
          <span class="inspector-metric-label">Target Coverages</span>
          <span class="inspector-metric-val" style="font-size:0.78rem;">#${pair.opp1.id}: ${pair.opp1.area_covered_pct}% | #${pair.opp2.id}: ${pair.opp2.area_covered_pct}%</span>
        </div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 10px;">
        <button class="btn btn-primary" style="flex:1; justify-content:center; padding:5px 8px; font-size:0.75rem;" id="btn-inspector-restore">
          Restore All Swaths
        </button>
        <button class="btn" style="flex:1; justify-content:center; padding:5px 8px; font-size:0.75rem;" id="btn-inspector-select">
          Select in Table
        </button>
      </div>
    `;

    document.getElementById('btn-inspector-restore').addEventListener('click', restoreAllFromIsolation);

    document.getElementById('btn-inspector-select').addEventListener('click', () => {
      selectedIds.clear();
      selectedIds.add(pair.opp1.id);
      selectedIds.add(pair.opp2.id);
      updateKPIs();
      renderTable();
    });

    card.style.display = 'block';

    // Highlight and isolate footprints on map
    highlightPairOnMap(pair);
  }

  // Restore Map and Network Chart from Pair Isolation
  function restoreAllFromIsolation() {
    isolatedPair = null;
    selectedPair = null;
    document.getElementById('network-inspector').style.display = 'none';
    intersectionLayerGroup.clearLayers();
    renderMapSwaths();
    renderNetworkChart();
  }

  // Highlight Both Swaths and their Overlap Geometry on Leaflet Map
  function highlightPairOnMap(pair) {
    intersectionLayerGroup.clearLayers();

    // Re-render map swaths to only show opp1 and opp2
    renderMapSwaths();
    renderNetworkChart();

    // Calculate and draw polygon intersection on Leaflet
    if (typeof turf !== 'undefined') {
      try {
        const ringA = pair.opp1.coordinates.map(p => [p[0], p[1]]);
        if (ringA[0][0] !== ringA[ringA.length - 1][0] || ringA[0][1] !== ringA[ringA.length - 1][1]) ringA.push([ringA[0][0], ringA[0][1]]);
        const ringB = pair.opp2.coordinates.map(p => [p[0], p[1]]);
        if (ringB[0][0] !== ringB[ringB.length - 1][0] || ringB[0][1] !== ringB[ringB.length - 1][1]) ringB.push([ringB[0][0], ringB[0][1]]);

        const polyA = turf.polygon([ringA]);
        const polyB = turf.polygon([ringB]);
        const intersection = turf.intersect(polyA, polyB);

        if (intersection) {
          const interLayer = L.geoJSON(intersection, {
            style: {
              color: '#f43f5e',
              weight: 3,
              fillColor: '#f43f5e',
              fillOpacity: 0.55,
              dashArray: '5, 5'
            }
          }).addTo(intersectionLayerGroup);

          interLayer.bindTooltip(`<b>Shared Footprint:</b> ${pair.shared_area_km2.toFixed(2)} km²<br><b>Δt:</b> ${pair.dt_days.toFixed(2)} days`, { sticky: true });
        }
      } catch (err) {
        console.warn('Leaflet intersection draw error:', err);
      }
    }

    // Zoom map to fit both footprints
    const allCoords = [
      ...pair.opp1.coordinates.map(c => [c[1], c[0]]),
      ...pair.opp2.coordinates.map(c => [c[1], c[0]])
    ];
    const bounds = L.latLngBounds(allCoords);
    map.fitBounds(bounds, { padding: [40, 40] });
  }

  // Export Active Network Pairs to Excel (.xlsx / .csv) via SheetJS or Native Blob
  function exportNetworkPairsXLSX() {
    let pairsToExport = activeNetworkPairs;
    if (!pairsToExport || pairsToExport.length === 0) {
      pairsToExport = computeNetworkPairs();
    }

    if (!pairsToExport || pairsToExport.length === 0) {
      alert('No active network pairs to export with the current filter criteria.');
      return;
    }

    const rows = [
      [
        'Network_Name',
        'Pair_Index',
        'Opp1_ID',
        'Opp1_Date',
        'Opp1_Start_UTC',
        'Opp1_Pass_Look_Combo',
        'Opp1_Sensor',
        'Opp1_Look_Angle_deg',
        'Opp1_Coverage_pct',
        'Opp2_ID',
        'Opp2_Date',
        'Opp2_Start_UTC',
        'Opp2_Pass_Look_Combo',
        'Opp2_Sensor',
        'Opp2_Look_Angle_deg',
        'Opp2_Coverage_pct',
        'Time_Distance_Hours',
        'Time_Distance_Days',
        'Look_Angle_Diff_deg',
        'Shared_Footprint_Area_km2',
        'Pairing_Algorithm'
      ]
    ];

    pairsToExport.forEach((pair, idx) => {
      rows.push([
        pair.networkName,
        idx + 1,
        pair.opp1.id,
        pair.opp1.date,
        pair.opp1.start,
        pair.opp1.pass_look_combo,
        pair.opp1.sensor,
        pair.opp1.look_angle,
        pair.opp1.area_covered_pct,
        pair.opp2.id,
        pair.opp2.date,
        pair.opp2.start,
        pair.opp2.pass_look_combo,
        pair.opp2.sensor,
        pair.opp2.look_angle,
        pair.opp2.area_covered_pct,
        parseFloat(pair.dt_hours.toFixed(2)),
        parseFloat(pair.dt_days.toFixed(2)),
        parseFloat(pair.look_diff.toFixed(2)),
        parseFloat(pair.shared_area_km2.toFixed(2)),
        networkSettings.mode === 'STRICT_CHAIN' ? 'Strict Chronological Chain' : (networkSettings.mode === 'MONITORING_NETWORK' ? `Monitoring Network (${networkSettings.monitoringPref})` : `Max Time Window (<= ${networkSettings.maxDays}d)`)
      ]);
    });

    // Option A: If SheetJS (XLSX) is available, output native .xlsx
    if (typeof XLSX !== 'undefined') {
      try {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Network_Pairs');
        XLSX.writeFile(wb, `ICEYE_Network_Pairs_${new Date().toISOString().substring(0, 10)}.xlsx`);
        return;
      } catch (err) {
        console.warn('XLSX export failed, falling back to direct Excel CSV:', err);
      }
    }

    // Option B: Direct native RFC-4180 CSV with UTF-8 BOM (Opens immediately in Excel with zero libraries)
    const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ICEYE_Network_Pairs_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 150);
  }

  // Event Listeners for UI Controls
  function setupEventListeners() {
    // Base Map Selector Buttons
    document.getElementById('base-satellite').addEventListener('click', (e) => setBaseLayer('satellite', e.target));
    document.getElementById('base-dark').addEventListener('click', (e) => setBaseLayer('dark', e.target));
    document.getElementById('base-topo').addEventListener('click', (e) => setBaseLayer('topo', e.target));

    function setBaseLayer(key, btn) {
      if (currentBaseLayer) map.removeLayer(currentBaseLayer);
      currentBaseLayer = baseLayers[key];
      currentBaseLayer.addTo(map);

      document.querySelectorAll('.layer-toggle-group .layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }

    // Toggle Layers
    document.getElementById('toggle-aoi').addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      if (map.hasLayer(aoiLayerGroup)) map.removeLayer(aoiLayerGroup);
      else aoiLayerGroup.addTo(map);
    });

    document.getElementById('toggle-swaths').addEventListener('click', (e) => {
      e.target.classList.toggle('active');
      if (map.hasLayer(swathLayerGroup)) map.removeLayer(swathLayerGroup);
      else swathLayerGroup.addTo(map);
    });

    // Pass & Look Direction Combo Badges
    document.querySelectorAll('#combo-badge-group .combo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const combo = btn.dataset.combo;
        if (activeFilters.combos.has(combo)) {
          if (activeFilters.combos.size > 1) {
            activeFilters.combos.delete(combo);
            btn.classList.remove('active');
          }
        } else {
          activeFilters.combos.add(combo);
          btn.classList.add('active');
        }
        applyFilters();
      });
    });

    // Date Range Picker Listeners
    const inputDateStart = document.getElementById('date-start');
    const inputDateEnd = document.getElementById('date-end');

    inputDateStart.addEventListener('change', (e) => {
      activeFilters.startDate = e.target.value;
      resetDateQuickButtons();
      applyFilters();
    });

    inputDateEnd.addEventListener('change', (e) => {
      activeFilters.endDate = e.target.value;
      resetDateQuickButtons();
      applyFilters();
    });

    function setDateRange(startStr, endStr, activeBtn) {
      activeFilters.startDate = startStr;
      activeFilters.endDate = endStr;
      inputDateStart.value = startStr;
      inputDateEnd.value = endStr;

      resetDateQuickButtons();
      if (activeBtn) activeBtn.classList.add('active');

      applyFilters();
    }

    function resetDateQuickButtons() {
      document.querySelectorAll('#date-quick-badges .chip-btn').forEach(b => b.classList.remove('active'));
    }

    // Look Angle Sliders & Inputs
    const sliderLookMin = document.getElementById('slider-look-min');
    const sliderLookMax = document.getElementById('slider-look-max');
    const numLookMin = document.getElementById('num-look-min');
    const numLookMax = document.getElementById('num-look-max');

    function syncLookAngle() {
      activeFilters.lookMin = parseFloat(numLookMin.value);
      activeFilters.lookMax = parseFloat(numLookMax.value);
      document.getElementById('val-look').textContent = `${activeFilters.lookMin}° - ${activeFilters.lookMax}°`;
      applyFilters();
    }

    if (sliderLookMin && sliderLookMax && numLookMin && numLookMax) {
      sliderLookMin.addEventListener('input', (e) => {
        numLookMin.value = e.target.value;
        syncLookAngle();
      });
      sliderLookMax.addEventListener('input', (e) => {
        numLookMax.value = e.target.value;
        syncLookAngle();
      });
      numLookMin.addEventListener('change', (e) => {
        sliderLookMin.value = e.target.value;
        syncLookAngle();
      });
      numLookMax.addEventListener('change', (e) => {
        sliderLookMax.value = e.target.value;
        syncLookAngle();
      });
    }

    // Target Coverage Sliders
    const sliderCovMin = document.getElementById('slider-cov-min');
    const numCovMin = document.getElementById('num-cov-min');
    const numCovMax = document.getElementById('num-cov-max');

    sliderCovMin.addEventListener('input', (e) => {
      numCovMin.value = e.target.value;
      activeFilters.covMin = parseFloat(e.target.value);
      document.getElementById('val-coverage').textContent = `${activeFilters.covMin}% - ${activeFilters.covMax}%`;
      applyFilters();
    });
    numCovMin.addEventListener('change', (e) => {
      sliderCovMin.value = e.target.value;
      activeFilters.covMin = parseFloat(e.target.value);
      applyFilters();
    });
    numCovMax.addEventListener('change', (e) => {
      activeFilters.covMax = parseFloat(e.target.value);
      applyFilters();
    });

    // OZA Slider
    const sliderOzaMax = document.getElementById('slider-oza-max');
    sliderOzaMax.addEventListener('input', (e) => {
      activeFilters.ozaMax = parseFloat(e.target.value);
      document.getElementById('lbl-oza-max').textContent = `\u2264 ${activeFilters.ozaMax}°`;
      document.getElementById('val-oza').textContent = `15° - ${activeFilters.ozaMax}°`;
      applyFilters();
    });

    // SZA Daylight / Night Badges
    document.getElementById('sza-all').addEventListener('click', (e) => setSzaMode('ALL', e.target));
    document.getElementById('sza-day').addEventListener('click', (e) => setSzaMode('DAY', e.target));
    document.getElementById('sza-night').addEventListener('click', (e) => setSzaMode('NIGHT', e.target));

    function setSzaMode(mode, btn) {
      activeFilters.szaMode = mode;
      document.querySelectorAll('#sza-all, #sza-day, #sza-night').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    }

    // Search input
    document.getElementById('search-id').addEventListener('input', (e) => {
      activeFilters.searchQuery = e.target.value.trim();
      applyFilters();
    });

    // Quick Presets
    document.getElementById('preset-100cov').addEventListener('click', () => {
      numCovMin.value = 100;
      sliderCovMin.value = 100;
      activeFilters.covMin = 100;
      applyFilters();
    });

    const presetHighLook = document.getElementById('preset-highlook') || document.getElementById('preset-lowlook');
    if (presetHighLook && numLookMin && sliderLookMin) {
      presetHighLook.addEventListener('click', () => {
        numLookMin.value = 30;
        sliderLookMin.value = 30;
        activeFilters.lookMin = 30;
        syncLookAngle();
      });
    }

    const presetWestLooking = document.getElementById('preset-west-looking') || document.getElementById('preset-asc-left');
    if (presetWestLooking) {
      presetWestLooking.addEventListener('click', () => {
        activeFilters.combos = new Set(['ASCENDING - LEFT', 'DESCENDING - RIGHT']);
        document.querySelectorAll('#combo-badge-group .combo-btn').forEach(b => {
          const combo = b.dataset.combo;
          if (combo === 'ASCENDING - LEFT' || combo === 'DESCENDING - RIGHT') {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
        applyFilters();
      });
    }

    const presetEastLooking = document.getElementById('preset-east-looking') || document.getElementById('preset-desc-right');
    if (presetEastLooking) {
      presetEastLooking.addEventListener('click', () => {
        activeFilters.combos = new Set(['ASCENDING - RIGHT', 'DESCENDING - LEFT']);
        document.querySelectorAll('#combo-badge-group .combo-btn').forEach(b => {
          const combo = b.dataset.combo;
          if (combo === 'ASCENDING - RIGHT' || combo === 'DESCENDING - LEFT') {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
        applyFilters();
      });
    }

    // Reset All Filters
    document.getElementById('btn-reset-filters').addEventListener('click', () => {
      activeFilters = {
        combos: new Set(['ASCENDING - LEFT', 'ASCENDING - RIGHT', 'DESCENDING - LEFT', 'DESCENDING - RIGHT']),
        startDate: '2026-08-23',
        endDate: '2026-09-05',
        lookMin: 15,
        lookMax: 40,
        covMin: 0,
        covMax: 100,
        ozaMax: 50,
        szaMode: 'ALL',
        searchQuery: ''
      };

      if (numLookMin && sliderLookMin && numLookMax && sliderLookMax) {
        numLookMin.value = 15; sliderLookMin.value = 15;
        numLookMax.value = 40; sliderLookMax.value = 40;
        document.getElementById('val-look').textContent = `15° - 40°`;
      }
      numCovMin.value = 0; sliderCovMin.value = 0;
      numCovMax.value = 100;
      sliderOzaMax.value = 50;
      document.getElementById('search-id').value = '';
      inputDateStart.value = '2026-08-23';
      inputDateEnd.value = '2026-09-05';

      document.querySelectorAll('#combo-badge-group .combo-btn').forEach(b => b.classList.add('active'));
      setDateRange('2026-08-23', '2026-09-05', document.getElementById('date-btn-all'));
      setSzaMode('ALL', document.getElementById('sza-all'));
    });

    // Bottom Drawer Tab Switching
    document.querySelectorAll('.drawer-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.drawer-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.drawer-tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const targetTab = btn.dataset.tab;
        const targetContent = document.getElementById(targetTab);
        if (targetContent) {
          targetContent.classList.add('active');
        }

        if (targetTab === 'tab-analytics') {
          setTimeout(renderNetworkChart, 50);
        } else if (targetTab === 'tab-timeline') {
          setTimeout(renderGanttTimeline, 50);
        }
      });
    });

    // Drag-to-Resize Bottom Drawer Vertically
    const drawer = document.getElementById('bottom-drawer');
    const resizeHandle = document.getElementById('drawer-resize-handle');
    let isDragging = false;
    let startY = 0;
    let startHeight = 330;

    // Invisible full-window drag shield to prevent Leaflet/SVGs from capturing pointer
    let dragShield = document.getElementById('drawer-drag-shield');
    if (!dragShield) {
      dragShield = document.createElement('div');
      dragShield.id = 'drawer-drag-shield';
      dragShield.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;cursor:ns-resize;display:none;user-select:none;';
      document.body.appendChild(dragShield);
    }

    function onDragStart(clientY, e) {
      isDragging = true;
      startY = clientY;
      startHeight = drawer.getBoundingClientRect().height;
      drawer.classList.add('resizing');
      drawer.classList.remove('collapsed', 'maximized');
      if (resizeHandle) resizeHandle.classList.add('active');
      dragShield.style.display = 'block';
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      if (e && e.preventDefault) e.preventDefault();
    }

    function onDragMove(clientY) {
      if (!isDragging) return;
      const delta = startY - clientY;
      let newHeight = startHeight + delta;
      const minHeight = 140;
      const maxHeight = Math.round(window.innerHeight * 0.88);
      if (newHeight < minHeight) newHeight = minHeight;
      if (newHeight > maxHeight) newHeight = maxHeight;

      drawer.style.height = `${newHeight}px`;
      if (map) map.invalidateSize();
      renderNetworkChart();
    }

    function onDragEnd() {
      if (isDragging) {
        isDragging = false;
        drawer.classList.remove('resizing');
        if (resizeHandle) resizeHandle.classList.remove('active');
        dragShield.style.display = 'none';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (map) map.invalidateSize();
        renderNetworkChart();
        renderGanttTimeline();
      }
    }

    if (resizeHandle && drawer) {
      resizeHandle.addEventListener('mousedown', (e) => onDragStart(e.clientY, e));
      resizeHandle.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) onDragStart(e.touches[0].clientY, e);
      }, { passive: false });

      window.addEventListener('mousemove', (e) => {
        if (isDragging) onDragMove(e.clientY);
      });
      window.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches && e.touches[0]) onDragMove(e.touches[0].clientY);
      }, { passive: false });

      window.addEventListener('mouseup', onDragEnd);
      window.addEventListener('touchend', onDragEnd);
    }

    // Maximize / Restore Drawer Height
    const btnMaximizeDrawer = document.getElementById('btn-maximize-drawer');
    if (btnMaximizeDrawer && drawer) {
      btnMaximizeDrawer.addEventListener('click', () => {
        drawer.classList.remove('collapsed');
        if (drawer.classList.contains('maximized')) {
          drawer.classList.remove('maximized');
          drawer.style.height = '330px';
        } else {
          drawer.classList.add('maximized');
          drawer.style.height = `${Math.round(window.innerHeight * 0.72)}px`;
        }
        setTimeout(() => {
          if (map) map.invalidateSize();
          renderNetworkChart();
          renderGanttTimeline();
        }, 280);
      });
    }

    // Collapse / Expand Drawer
    const btnToggleDrawer = document.getElementById('btn-toggle-drawer');
    if (btnToggleDrawer && drawer) {
      btnToggleDrawer.addEventListener('click', () => {
        drawer.classList.toggle('collapsed');
        setTimeout(() => {
          renderNetworkChart();
          renderGanttTimeline();
        }, 350);
      });
    }

    // Window Resize Handler
    window.addEventListener('resize', () => {
      renderNetworkChart();
    });

    // Network Toggle Handlers
    const toggleNet1 = document.getElementById('toggle-net-1');
    if (toggleNet1) {
      toggleNet1.addEventListener('click', () => {
        networkSettings.enableNet1 = !networkSettings.enableNet1;
        toggleNet1.classList.toggle('active', networkSettings.enableNet1);
        renderNetworkChart();
      });
    }

    const toggleNet2 = document.getElementById('toggle-net-2');
    if (toggleNet2) {
      toggleNet2.addEventListener('click', () => {
        networkSettings.enableNet2 = !networkSettings.enableNet2;
        toggleNet2.classList.toggle('active', networkSettings.enableNet2);
        renderNetworkChart();
      });
    }

    // Pairing Mode Segmented Buttons
    const btnStrict = document.getElementById('mode-strict-chain');
    const btnTimeWin = document.getElementById('mode-time-window');
    const btnMonitoring = document.getElementById('mode-monitoring-network');
    const timeWinCtrls = document.getElementById('time-window-ctrls');
    const monitoringCtrls = document.getElementById('monitoring-ctrls');

    function updateModeButtonsUI(activeMode) {
      if (btnStrict) btnStrict.classList.toggle('active', activeMode === 'STRICT_CHAIN');
      if (btnTimeWin) btnTimeWin.classList.toggle('active', activeMode === 'TIME_WINDOW');
      if (btnMonitoring) btnMonitoring.classList.toggle('active', activeMode === 'MONITORING_NETWORK');

      if (timeWinCtrls) timeWinCtrls.style.display = activeMode === 'TIME_WINDOW' ? 'inline-flex' : 'none';
      if (monitoringCtrls) monitoringCtrls.style.display = activeMode === 'MONITORING_NETWORK' ? 'inline-flex' : 'none';
    }

    if (btnStrict) {
      btnStrict.addEventListener('click', () => {
        networkSettings.mode = 'STRICT_CHAIN';
        updateModeButtonsUI('STRICT_CHAIN');
        renderNetworkChart();
      });
    }

    if (btnTimeWin) {
      btnTimeWin.addEventListener('click', () => {
        networkSettings.mode = 'TIME_WINDOW';
        updateModeButtonsUI('TIME_WINDOW');
        renderNetworkChart();
      });
    }

    if (btnMonitoring) {
      btnMonitoring.addEventListener('click', () => {
        networkSettings.mode = 'MONITORING_NETWORK';
        updateModeButtonsUI('MONITORING_NETWORK');
        renderNetworkChart();
      });
    }

    const selectMonitoringPref = document.getElementById('select-monitoring-pref');
    if (selectMonitoringPref) {
      selectMonitoringPref.addEventListener('change', (e) => {
        networkSettings.monitoringPref = e.target.value;
        renderNetworkChart();
      });
    }

    // Max Days Select
    const selectMaxDays = document.getElementById('select-max-days');
    if (selectMaxDays) {
      selectMaxDays.addEventListener('change', (e) => {
        networkSettings.maxDays = parseFloat(e.target.value);
        renderNetworkChart();
      });
    }

    // Show Line Labels Checkbox
    const chkLineLabels = document.getElementById('chk-show-line-labels');
    if (chkLineLabels) {
      chkLineLabels.addEventListener('change', (e) => {
        networkSettings.showLineLabels = e.target.checked;
        renderNetworkChart();
      });
    }

    // Export Network Pairs (.xlsx) Button
    const btnExportNet = document.getElementById('btn-export-network-xlsx');
    if (btnExportNet) {
      btnExportNet.addEventListener('click', exportNetworkPairsXLSX);
    }

    // Close Inspector Card
    const btnCloseInspector = document.getElementById('inspector-close');
    if (btnCloseInspector) {
      btnCloseInspector.addEventListener('click', restoreAllFromIsolation);
    }

    // Select All Checkbox
    const chkSelectAll = document.getElementById('chk-select-all');
    if (chkSelectAll) {
      chkSelectAll.addEventListener('change', (e) => {
        const checked = e.target.checked;
        if (checked) {
          filteredOpportunities.forEach(opp => selectedIds.add(opp.id));
        } else {
          selectedIds.clear();
        }
        updateKPIs();
        renderMapSwaths();
        renderTable();
        renderGanttTimeline();
        renderNetworkChart();
      });
    }

    // Clear Selection Button
    const btnClearSelection = document.getElementById('btn-clear-selection');
    if (btnClearSelection) {
      btnClearSelection.addEventListener('click', () => {
        selectedIds.clear();
        const chkAll = document.getElementById('chk-select-all');
        if (chkAll) chkAll.checked = false;
        updateKPIs();
        renderMapSwaths();
        renderTable();
        renderGanttTimeline();
        renderNetworkChart();
      });
    }

    // Open Comparison Modal
    const btnCompare = document.getElementById('btn-compare');
    if (btnCompare) btnCompare.addEventListener('click', openComparisonModal);
    
    const btnCloseCompare = document.getElementById('btn-close-compare');
    if (btnCloseCompare) {
      btnCloseCompare.addEventListener('click', () => {
        document.getElementById('modal-compare').classList.remove('active');
      });
    }

    // Export Handler
    const btnExportMenu = document.getElementById('btn-export-menu');
    if (btnExportMenu) btnExportMenu.addEventListener('click', exportDatasetCSV);
  }

  // Render Side-by-Side Comparison Grid
  function openComparisonModal() {
    const modal = document.getElementById('modal-compare');
    const grid = document.getElementById('compare-grid');
    grid.innerHTML = '';

    const selectedList = allOpportunities.filter(opp => selectedIds.has(opp.id));

    if (selectedList.length === 0) {
      grid.innerHTML = '<div style="color: var(--text-muted);">No opportunities selected. Click checkboxes in table or swaths on map to select items to compare.</div>';
    } else {
      selectedList.forEach(opp => {
        const card = document.createElement('div');
        card.className = 'compare-card';

        const badgeClass = getComboBadgeClass(opp.pass_look_combo);
        const symbol = opp.pass_look_combo.includes('LEFT') ? '◀' : '▶';

        card.innerHTML = `
          <div class="compare-card-header">
            <span class="compare-card-title">Opportunity #${opp.id}</span>
            <span class="badge-pass ${badgeClass}">${symbol} ${opp.pass_look_combo}</span>
          </div>
          <div class="compare-prop-row"><span class="compare-prop-label">Sensor Mode:</span> <span class="compare-prop-val">${opp.sensor}</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">Date:</span> <span class="compare-prop-val">${opp.date}</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">Start Time:</span> <span class="compare-prop-val">${new Date(opp.start).toISOString().replace('T',' ').substring(0,16)}</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">Look Angle:</span> <span class="compare-prop-val" style="color: #6366f1;">${opp.look_angle}°</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">Incidence Angle:</span> <span class="compare-prop-val">${opp.min_incid}° - ${opp.max_incid}°</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">OZA:</span> <span class="compare-prop-val">${opp.oza}°</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">SZA:</span> <span class="compare-prop-val">${opp.sza}°</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">Azimuth:</span> <span class="compare-prop-val">${opp.azimuth}°</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">Orbit / Scenes:</span> <span class="compare-prop-val">${opp.orbit} / ${opp.scenes}</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">Polarization:</span> <span class="compare-prop-val">${opp.polarization}</span></div>
          <div class="compare-prop-row"><span class="compare-prop-label">Target Coverage:</span> <span class="compare-prop-val" style="color: #10b981; font-size: 1rem;">${opp.area_covered_pct}%</span></div>
          <button class="btn btn-accent" style="width: 100%; margin-top: 8px; justify-content: center;" onclick="zoomToOpportunity(${opp.id})">Locate on Map</button>
        `;
        grid.appendChild(card);
      });
    }

    modal.classList.add('active');
  }

  // Export filtered or selected data as CSV
  function exportDatasetCSV() {
    const listToExport = selectedIds.size > 0 
      ? allOpportunities.filter(o => selectedIds.has(o.id))
      : filteredOpportunities;

    if (listToExport.length === 0) {
      alert('No data to export.');
      return;
    }

    const headers = ['Opportunity_ID', 'Date', 'Pass_Look_Combo', 'Pass', 'Look_Direction', 'Sensor', 'Start', 'End', 'LookAngle', 'Min_Incid', 'Max_Incid', 'OZA', 'SZA', 'Azimuth', 'AreaCovered_Pct', 'Target_km2'];
    const rows = listToExport.map(o => [
      o.id, o.date, `"${o.pass_look_combo}"`, o.pass, o.look_direction, `"${o.sensor}"`, o.start, o.end, o.look_angle, o.min_incid, o.max_incid, o.oza, o.sza, o.azimuth, o.area_covered_pct, o.target_in_image_km2
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `acquisitions_export_${new Date().toISOString().substring(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  window.zoomToOpportunity = zoomToOpportunity;
  window.exportNetworkPairsXLSX = exportNetworkPairsXLSX;

  // ==================== DYNAMIC UI & CAMPAIGN MANAGEMENT ====================
  function renderDateQuickBadges() {
    const container = document.getElementById('date-quick-badges');
    if (!container) return;
    container.innerHTML = '';

    const minDateStr = data && data.metadata && data.metadata.date_range ? data.metadata.date_range[0] : activeFilters.startDate;
    const maxDateStr = data && data.metadata && data.metadata.date_range ? data.metadata.date_range[1] : activeFilters.endDate;

    const allBtn = document.createElement('button');
    allBtn.className = 'chip-btn active';
    allBtn.textContent = 'All Days';
    allBtn.addEventListener('click', (e) => setDateRange(minDateStr, maxDateStr, e.target));
    container.appendChild(allBtn);

    if (minDateStr && maxDateStr) {
      const dStart = new Date(minDateStr);
      const dEnd = new Date(maxDateStr);
      const totalDays = Math.max(1, Math.round((dEnd - dStart) / (1000 * 60 * 60 * 24)) + 1);

      if (totalDays >= 3) {
        const chunk = Math.floor(totalDays / 3);
        const ranges = [
          { start: new Date(dStart), end: new Date(dStart.getTime() + (chunk - 1) * 86400000) },
          { start: new Date(dStart.getTime() + chunk * 86400000), end: new Date(dStart.getTime() + (2 * chunk - 1) * 86400000) },
          { start: new Date(dStart.getTime() + 2 * chunk * 86400000), end: dEnd }
        ];

        ranges.forEach(r => {
          const sStr = r.start.toISOString().split('T')[0];
          const eStr = r.end.toISOString().split('T')[0];
          const fmtLabel = `${r.start.toLocaleDateString('en-US', {month:'short', day:'numeric'})} - ${r.end.toLocaleDateString('en-US', {month:'short', day:'numeric'})}`;
          
          const btn = document.createElement('button');
          btn.className = 'chip-btn';
          btn.textContent = fmtLabel;
          btn.addEventListener('click', (e) => setDateRange(sStr, eStr, e.target));
          container.appendChild(btn);
        });
      }
    }
  }

  function setDateRange(startStr, endStr, activeBtn) {
    activeFilters.startDate = startStr;
    activeFilters.endDate = endStr;
    const inputDateStart = document.getElementById('date-start');
    const inputDateEnd = document.getElementById('date-end');
    if (inputDateStart) inputDateStart.value = startStr;
    if (inputDateEnd) inputDateEnd.value = endStr;

    document.querySelectorAll('#date-quick-badges .chip-btn').forEach(b => b.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');

    applyFilters();
  }

  function getSavedCampaigns() {
    try {
      const raw = localStorage.getItem('iceye_custom_campaigns') || localStorage.getItem('aethel_custom_campaigns');
      return raw ? JSON.parse(raw) : {};
    } catch(e) { return {}; }
  }

  function saveCampaignToStorage(id, campaignData) {
    try {
      const campaigns = getSavedCampaigns();
      campaigns[id] = campaignData;
      localStorage.setItem('iceye_custom_campaigns', JSON.stringify(campaigns));
    } catch(e) { console.error('Error saving campaign to localStorage:', e); }
  }

  function updateCampaignSelectDropdown(selectedId = 'default') {
    const select = document.getElementById('select-campaign');
    if (!select) return;
    const defaultLabel = (data && data.metadata && data.metadata.aoi_name) ? data.metadata.aoi_name : 'Default Campaign';
    select.innerHTML = `<option value="default">${defaultLabel}</option>`;
    
    const saved = getSavedCampaigns();
    for (let key in saved) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = saved[key].metadata.aoi_name || key;
      select.appendChild(opt);
    }
    select.value = selectedId;
  }

  // ==================== BROWSER CLIENT-SIDE PARSER ====================
  function parseExcelBrowser(arrayBuffer) {
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS library (XLSX) is not loaded.');
    }
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    return rows;
  }

  function parseKMLBrowser(kmlText) {
    const kmlPolygons = new Map();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(kmlText, "text/xml");
    const placemarks = xmlDoc.getElementsByTagName("Placemark");

    for (let pm of placemarks) {
      let oppId = null;
      const dataElems = pm.getElementsByTagName("Data");
      for (let d of dataElems) {
        if (d.getAttribute("name") === "Opportunity_ID") {
          const valNode = d.getElementsByTagName("value")[0];
          if (valNode) {
            const txt = valNode.textContent.trim();
            oppId = isNaN(Number(txt)) ? txt : Number(txt);
          }
        }
      }

      const coordNode = pm.getElementsByTagName("coordinates")[0];
      if (coordNode && coordNode.textContent) {
        const pts = coordNode.textContent.trim().split(/\s+/);
        const ring = [];
        pts.forEach(pt => {
          const parts = pt.split(',');
          if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lon) && !isNaN(lat)) {
              ring.push([lon, lat]);
            }
          }
        });
        if (oppId !== null && ring.length > 0) {
          kmlPolygons.set(oppId, ring);
        }
      }
    }
    return kmlPolygons;
  }

  function parseAOIPolygonBrowser(fileText, fileName) {
    if (fileName.endsWith('.json') || fileName.endsWith('.geojson')) {
      try {
        const geojson = JSON.parse(fileText);
        if (geojson.type === 'FeatureCollection' && geojson.features.length > 0) {
          return geojson.features[0].geometry.coordinates[0];
        } else if (geojson.type === 'Feature') {
          return geojson.geometry.coordinates[0];
        } else if (geojson.coordinates) {
          return geojson.coordinates[0] || geojson.coordinates;
        }
      } catch(e) { console.error('Error parsing AOI GeoJSON:', e); }
    } else {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(fileText, "text/xml");
      const coordNode = xmlDoc.getElementsByTagName("coordinates")[0];
      if (coordNode && coordNode.textContent) {
        const pts = coordNode.textContent.trim().split(/\s+/);
        const ring = [];
        pts.forEach(pt => {
          const parts = pt.split(',');
          if (parts.length >= 2) {
            ring.push([parseFloat(parts[0]), parseFloat(parts[1])]);
          }
        });
        return ring;
      }
    }
    return null;
  }

  function buildDatasetFromRaw(rows, kmlPolygons, customAoiName, customAoiPoly) {
    let min_lat = 90.0, max_lat = -90.0;
    let min_lon = 180.0, max_lon = -180.0;
    
    const opportunities = [];
    const features = [];
    const comboSet = new Set();
    const dateList = [];
    const sensorTypes = new Set();
    const passTypes = new Set();
    const polarizations = new Set();

    let incidMin = Infinity, incidMax = -Infinity;
    let ozaMin = Infinity, ozaMax = -Infinity;
    let szaMin = Infinity, szaMax = -Infinity;
    let azMin = Infinity, azMax = -Infinity;
    let covMin = Infinity, covMax = -Infinity;
    let minDate = '9999-99-99', maxDate = '0000-00-00';

    rows.forEach((row, idx) => {
      const oppId = row.Opportunity_ID !== undefined ? row.Opportunity_ID : (idx + 1);
      
      let coords = kmlPolygons && kmlPolygons.has(oppId) ? kmlPolygons.get(oppId) : null;
      if (!coords && row.NW_Lon !== undefined) {
        coords = [
          [parseFloat(row.NW_Lon), parseFloat(row.NW_Lat)],
          [parseFloat(row.NE_Lon), parseFloat(row.NE_Lat)],
          [parseFloat(row.SE_Lon), parseFloat(row.SE_Lat)],
          [parseFloat(row.SW_Lon), parseFloat(row.SW_Lat)],
          [parseFloat(row.NW_Lon), parseFloat(row.NW_Lat)]
        ];
      }
      if (!coords) return;

      coords.forEach(pt => {
        min_lon = Math.min(min_lon, pt[0]);
        max_lon = Math.max(max_lon, pt[0]);
        min_lat = Math.min(min_lat, pt[1]);
        max_lat = Math.max(max_lat, pt[1]);
      });

      const dtStart = new Date(row.Start);
      const dtEnd = new Date(row.End || row.Start);
      const startIso = dtStart.toISOString();
      const endIso = dtEnd.toISOString();
      const dateStr = startIso.split('T')[0];
      dateList.push(dateStr);

      if (dateStr < minDate) minDate = dateStr;
      if (dateStr > maxDate) maxDate = dateStr;

      const sensorStr = String(row.Sensor || 'SAR');
      const passStr = String(row.Pass || 'PASS').toUpperCase();
      sensorTypes.add(sensorStr);
      passTypes.add(passStr);

      let lookDir = "OTHER";
      if (sensorStr.toUpperCase().includes("LEFT")) lookDir = "LEFT";
      else if (sensorStr.toUpperCase().includes("RIGHT")) lookDir = "RIGHT";

      const passLookCombo = `${passStr} - ${lookDir}`;
      comboSet.add(passLookCombo);

      const incidVal = parseFloat(row.Min_Incid || row.LookAngle || 0);
      const incidMaxVal = parseFloat(row.Max_Incid || row.LookAngle || 0);
      const ozaVal = parseFloat(row.OZA || 0);
      const szaVal = parseFloat(row.SZA || 0);
      const azVal = parseFloat(row.Azimuth || 0);
      const covVal = parseFloat(row.AreaCovered || 0);

      incidMin = Math.min(incidMin, incidVal);
      incidMax = Math.max(incidMax, incidMaxVal);
      ozaMin = Math.min(ozaMin, ozaVal);
      ozaMax = Math.max(ozaMax, ozaVal);
      szaMin = Math.min(szaMin, szaVal);
      szaMax = Math.max(szaMax, szaVal);
      azMin = Math.min(azMin, azVal);
      azMax = Math.max(azMax, azVal);
      covMin = Math.min(covMin, covVal);
      covMax = Math.max(covMax, covVal);

      if (row.Polarization) polarizations.add(String(row.Polarization));

      const oppDict = {
        id: oppId,
        region: String(row.Region || customAoiName || 'Campaign Area'),
        constellation: String(row.Constellation || 'SAR'),
        sensor: sensorStr,
        look_direction: lookDir,
        pass: passStr,
        pass_look_combo: passLookCombo,
        start: startIso,
        end: endIso,
        date: dateStr,
        duration: parseInt(row.Duration || 0),
        scenes: parseInt(row.NumberOfScenes || 1),
        orbit: parseInt(row.Orbit || 0),
        center_lat: Math.round(parseFloat(row.Center_Lat || 0) * 100000) / 100000,
        center_lon: Math.round(parseFloat(row.Center_Lon || 0) * 100000) / 100000,
        area_covered_pct: Math.round(covVal * 100) / 100,
        target_in_image_km2: Math.round(parseFloat(row.TargetInImage || 0) * 100) / 100,
        polarization: String(row.Polarization || 'VV'),
        oza: Math.round(ozaVal * 100) / 100,
        sza: Math.round(szaVal * 100) / 100,
        look_angle: Math.round(parseFloat(row.LookAngle || incidVal) * 100) / 100,
        azimuth: Math.round(azVal * 100) / 100,
        min_incid: Math.round(incidVal * 100) / 100,
        max_incid: Math.round(incidMaxVal * 100) / 100,
        coordinates: coords
      };

      opportunities.push(oppDict);
      features.push({
        type: "Feature",
        id: oppId,
        properties: oppDict,
        geometry: { type: "Polygon", coordinates: [coords] }
      });
    });

    const aoiPoly = customAoiPoly || null;

    return {
      metadata: {
        total_count: opportunities.length,
        aoi_name: customAoiName || 'Campaign Region',
        aoi_polygon: aoiPoly,
        has_custom_aoi: !!customAoiPoly,
        bounds: {
          min_lat: Math.round(min_lat * 10000) / 10000,
          max_lat: Math.round(max_lat * 10000) / 10000,
          min_lon: Math.round(min_lon * 10000) / 10000,
          max_lon: Math.round(max_lon * 10000) / 10000
        },
        sensor_types: Array.from(sensorTypes).sort(),
        pass_types: Array.from(passTypes).sort(),
        look_directions: ["LEFT", "RIGHT"],
        pass_look_combos: Array.from(comboSet).sort(),
        unique_dates: Array.from(new Set(dateList)).sort(),
        polarizations: Array.from(polarizations).sort(),
        incid_range: [incidMin === Infinity ? 0 : incidMin, incidMax === -Infinity ? 50 : incidMax],
        oza_range: [ozaMin === Infinity ? 0 : ozaMin, ozaMax === -Infinity ? 50 : ozaMax],
        sza_range: [szaMin === Infinity ? 0 : szaMin, szaMax === -Infinity ? 90 : szaMax],
        azimuth_range: [azMin === Infinity ? 0 : azMin, azMax === -Infinity ? 360 : azMax],
        coverage_range: [covMin === Infinity ? 0 : covMin, covMax === -Infinity ? 100 : covMax],
        date_range: [minDate, maxDate]
      },
      geojson: { type: "FeatureCollection", features: features },
      opportunities: opportunities
    };
  }

  // ==================== IMPORT MODAL EVENT HANDLERS ====================
  let importFiles = {
    excel: null,
    kml: null,
    aoiPoly: null
  };

  function setupImportModalHandlers() {
    const modalImport = document.getElementById('modal-import');
    const btnUpload = document.getElementById('btn-upload');
    const btnCloseImport = document.getElementById('btn-close-import');
    const btnCancelImport = document.getElementById('btn-cancel-import');
    const btnSubmitImport = document.getElementById('btn-submit-import');

    const dropExcel = document.getElementById('dropzone-excel');
    const dropKml = document.getElementById('dropzone-kml');
    const fileExcel = document.getElementById('file-excel');
    const fileKml = document.getElementById('file-kml');
    const fileAoiPoly = document.getElementById('file-aoi-poly');

    if (btnUpload) {
      btnUpload.addEventListener('click', () => {
        if (modalImport) modalImport.style.display = 'flex';
      });
    }

    const closeModal = () => {
      if (modalImport) modalImport.style.display = 'none';
      const statusMsg = document.getElementById('import-status-msg');
      if (statusMsg) statusMsg.style.display = 'none';
    };

    if (btnCloseImport) btnCloseImport.addEventListener('click', closeModal);
    if (btnCancelImport) btnCancelImport.addEventListener('click', closeModal);

    const btnLoadDemo = document.getElementById('btn-load-demo-import');
    if (btnLoadDemo) {
      btnLoadDemo.addEventListener('click', () => {
        closeModal();
        loadDataset('default');
      });
    }

    if (dropExcel && fileExcel) {
      dropExcel.addEventListener('click', () => fileExcel.click());
      fileExcel.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleExcelSelected(e.target.files[0]);
      });
      setupDragDrop(dropExcel, (file) => handleExcelSelected(file));
    }

    if (dropKml && fileKml) {
      dropKml.addEventListener('click', () => fileKml.click());
      fileKml.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleKmlSelected(e.target.files[0]);
      });
      setupDragDrop(dropKml, (file) => handleKmlSelected(file));
    }

    // Window level drag & drop to easily open modal
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        if (modalImport && modalImport.style.display !== 'flex') {
          modalImport.style.display = 'flex';
        }
        Array.from(e.dataTransfer.files).forEach(f => {
          const name = f.name.toLowerCase();
          if (name.endsWith('.xlsx') || name.endsWith('.xls') || (name.endsWith('.xml') && !name.includes('aoi'))) {
            handleExcelSelected(f);
          } else if (name.endsWith('.kml')) {
            handleKmlSelected(f);
          } else if (name.endsWith('.geojson') || name.endsWith('.json')) {
            importFiles.aoiPoly = f;
          }
        });
      }
    });

    if (fileAoiPoly) {
      fileAoiPoly.addEventListener('change', (e) => {
        if (e.target.files.length > 0) importFiles.aoiPoly = e.target.files[0];
      });
    }

    function handleExcelSelected(file) {
      importFiles.excel = file;
      dropExcel.classList.add('loaded');
      document.getElementById('label-excel-status').textContent = `Loaded: ${file.name}`;
    }

    function handleKmlSelected(file) {
      importFiles.kml = file;
      dropKml.classList.add('loaded');
      document.getElementById('label-kml-status').textContent = `Loaded: ${file.name}`;
    }

    function setupDragDrop(el, onFile) {
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
      el.addEventListener('dragleave', () => el.classList.remove('dragover'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) onFile(e.dataTransfer.files[0]);
      });
    }

    if (btnSubmitImport) {
      btnSubmitImport.addEventListener('click', async () => {
        const statusMsg = document.getElementById('import-status-msg');
        statusMsg.style.display = 'block';
        statusMsg.className = 'import-status-msg';
        statusMsg.textContent = 'Parsing dataset...';

        if (!importFiles.excel) {
          statusMsg.className = 'import-status-msg error';
          statusMsg.textContent = 'Please select an Excel (.xlsx) feasibility file.';
          return;
        }

        try {
          const excelBuffer = await importFiles.excel.arrayBuffer();
          const rows = parseExcelBrowser(excelBuffer);

          let kmlPolygons = null;
          if (importFiles.kml) {
            const kmlText = await importFiles.kml.text();
            kmlPolygons = parseKMLBrowser(kmlText);
          }

          let customAoiPoly = null;
          if (importFiles.aoiPoly) {
            const aoiText = await importFiles.aoiPoly.text();
            customAoiPoly = parseAOIPolygonBrowser(aoiText, importFiles.aoiPoly.name);
          }

          const nameInput = document.getElementById('import-aoi-name');
          const customAoiName = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : importFiles.excel.name.replace(/\.[^/.]+$/, "");

          const newDataset = buildDatasetFromRaw(rows, kmlPolygons, customAoiName, customAoiPoly);

          const campaignId = 'campaign_' + Date.now();
          saveCampaignToStorage(campaignId, newDataset);

          data = newDataset;
          allOpportunities = data.opportunities;
          filteredOpportunities = [...allOpportunities];

          adaptUIForDataset(data);
          updateCampaignSelectDropdown(campaignId);
          updateMapForDataset();
          applyFilters();

          statusMsg.className = 'import-status-msg success';
          statusMsg.textContent = `Successfully imported '${newDataset.metadata.aoi_name}' with ${newDataset.opportunities.length} opportunities!`;

          setTimeout(() => closeModal(), 1200);

        } catch (err) {
          console.error('Import error:', err);
          statusMsg.className = 'import-status-msg error';
          statusMsg.textContent = `Error parsing files: ${err.message}`;
        }
      });
    }

    const selectCampaign = document.getElementById('select-campaign');
    if (selectCampaign) {
      selectCampaign.addEventListener('change', (e) => {
        loadDataset(e.target.value);
      });
    }
  }
});
