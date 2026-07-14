const VER = 'v1_';

// App State
let state = {
    data: [],
    columns: [],
    idCol: '',
    decCol: 'D4Decision',
    queue: [],
    currentIndex: 0,
    visibleCols: {},
    originalFilename: 'dataset',
    tablePage: 1,
    tableRowsPerPage: 50,
    detectedCols: {
        title: '',
        author: '',
        call: '',
        circ: [],
        meta: []
    },
    activeCardTab: 'circ'
};

let settings = {
    labels: { right: 'Keep', left: 'Ditch', up: 'Review', down: 'Skip' },
    colors: { right: '#22c55e', left: '#ef4444', up: '#eab308', down: '#94a3b8' },
    exportPattern: '{original_filename}_{subset_name}_{date}',
    callCol: '',
    theme: 'weed'
};

// LC Call Number Logic
function parseLC(callStr) {
    if (!callStr || typeof callStr !== 'string') return [];
    const norm = callStr.toUpperCase().replace(/\s+/g, ' ').trim();
    const regex = /^([A-Z]{1,3})\s*(\d+(?:\.\d+)?)?\s*(?:\.?([A-Z])(\d+))?(?:\s*\.?([A-Z])(\d+))?(?:\s+(.*))?$/;
    const match = norm.match(regex);
    if (!match) return [norm];

    return [
        match[1] || "",
        match[2] ? parseFloat(match[2]) : 0,
        match[3] || "",
        match[4] ? parseFloat("0." + match[4]) : 0,
        match[5] || "",
        match[6] ? parseFloat("0." + match[6]) : 0,
        match[7] || ""
    ];
}

function compareLC(a, b) {
    const pa = parseLC(a);
    const pb = parseLC(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const va = pa[i] !== undefined ? pa[i] : (typeof pb[i] === 'number' ? 0 : "");
        const vb = pb[i] !== undefined ? pb[i] : (typeof pa[i] === 'number' ? 0 : "");

        if (typeof va === 'string' && typeof vb === 'string') {
            const cmp = va.localeCompare(vb);
            if (cmp !== 0) return cmp;
        } else if (typeof va === 'number' && typeof vb === 'number') {
            if (va < vb) return -1;
            if (va > vb) return 1;
        } else {
            const sa = String(va);
            const sb = String(vb);
            const cmp = sa.localeCompare(sb);
            if (cmp !== 0) return cmp;
        }
    }
    return 0;
}

// IndexedDB Helper
const DB_NAME = 'LCTriageDB';
const DB_VER = 1;
const STORE_NAME = 'triageStore';

function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbSet(key, val) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGet(key) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbClear() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function saveData() {
    try {
        await idbSet(VER + 'state', state);
        await idbSet(VER + 'settings', settings);
    } catch(e) {
        console.error('Failed to save data', e);
    }
}

async function loadData() {
    try {
        // Try to migrate from localStorage if present
        let lsState = localStorage.getItem(VER + 'state');
        if (lsState) {
            state = JSON.parse(lsState);
            await idbSet(VER + 'state', state);
            localStorage.removeItem(VER + 'state');
        } else {
            const storedState = await idbGet(VER + 'state');
            if (storedState) state = storedState;
        }

        let lsSettings = localStorage.getItem(VER + 'settings');
        if (lsSettings) {
            settings = JSON.parse(lsSettings);
            await idbSet(VER + 'settings', settings);
            localStorage.removeItem(VER + 'settings');
        } else {
            const storedSettings = await idbGet(VER + 'settings');
            if (storedSettings) settings = storedSettings;
        }

        let lsSnapshots = localStorage.getItem(VER + 'snapshots');
        if (lsSnapshots) {
            const snaps = JSON.parse(lsSnapshots);
            await idbSet(VER + 'snapshots', snaps);
            localStorage.removeItem(VER + 'snapshots');
        }
    } catch(e) {
        console.error('Failed to load data', e);
    }
    applySettings();
}

function applySettings() {
    document.documentElement.style.setProperty('--color-keep', settings.colors.right);
    document.documentElement.style.setProperty('--color-ditch', settings.colors.left);
    document.documentElement.style.setProperty('--color-review', settings.colors.up);
    document.documentElement.style.setProperty('--color-skip', settings.colors.down);

    // Update labels in UI
    document.getElementById('lbl-keep-stat').textContent = settings.labels.right;
    document.getElementById('lbl-ditch-stat').textContent = settings.labels.left;
    document.getElementById('lbl-review-stat').textContent = settings.labels.up;
    document.getElementById('lbl-skip-stat').textContent = settings.labels.down;

    document.getElementById('badge-right').textContent = settings.labels.right;
    document.getElementById('badge-left').textContent = settings.labels.left;
    document.getElementById('badge-up').textContent = settings.labels.up;
    document.getElementById('badge-down').textContent = settings.labels.down;

    document.getElementById('btn-swipe-right').textContent = settings.labels.right + ' (→)';
    document.getElementById('btn-swipe-left').textContent = settings.labels.left + ' (←)';
    document.getElementById('btn-swipe-up').textContent = settings.labels.up + ' (↑)';
    document.getElementById('btn-swipe-down').textContent = settings.labels.down + ' (↓)';

    // Update settings form
    document.getElementById('set-lbl-right').value = settings.labels.right;
    document.getElementById('set-col-right').value = settings.colors.right;
    document.getElementById('set-lbl-left').value = settings.labels.left;
    document.getElementById('set-col-left').value = settings.colors.left;
    document.getElementById('set-lbl-up').value = settings.labels.up;
    document.getElementById('set-col-up').value = settings.colors.up;
    document.getElementById('set-lbl-down').value = settings.labels.down;
    document.getElementById('set-col-down').value = settings.colors.down;

    document.getElementById('set-dec-col').value = state.decCol;
    document.getElementById('set-export-pattern').value = settings.exportPattern;

    // Apply visual theme
    const activeTheme = settings.theme || 'weed';
    document.body.className = '';
    document.body.classList.add('theme-' + activeTheme);
    document.getElementById('set-theme').value = activeTheme;

    updateExportPreview();
}

// DOM Elements
const cardContainer = document.getElementById('current-card');
const badgeRight = document.getElementById('badge-right');
const badgeLeft = document.getElementById('badge-left');
const badgeUp = document.getElementById('badge-up');
const badgeDown = document.getElementById('badge-down');

// Init
window.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    if (state.data.length > 0) {
        detectColumns();
    }
    setupTabs();
    setupWizard();
    setupSwiper();
    setupDrawers();
    setupSettings();
    setupFilters();

    if (state.data.length > 0) {
        document.getElementById('tabsNav').style.display = 'flex';
        refreshApp();
    } else {
        document.getElementById('import-wizard').classList.add('active');
    }
});

function refreshApp() {
    updateDashboard();
    populateSelects();
    buildQueue();
    renderTable();
    populateSnapshots();
}

// Tabs
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.target).style.display = 'flex';
            if(e.target.dataset.target === 'swiper-view') {
                renderCard();
                renderWheel();
            }
        });
    });
}

// Smart Column Auto-Detection
function detectColumns() {
    if (!state.columns || state.columns.length === 0) return;

    state.detectedCols = {
        title: '',
        author: '',
        call: '',
        circ: [],
        meta: []
    };

    const titleGuesses = ['title', 'book title', 'book_title', 'main title', 'item title', 'name', 'desc', 'description'];
    const authorGuesses = ['author', 'creator', 'main author', 'book author', 'item author', 'contributors', 'personal name'];
    const callGuesses = ['call #', 'call number', 'call_number', 'callno', 'call', 'lc call', 'lc call #', 'lc_call', 'classification'];
    const circGuesses = [
        'checkout', 'charge', 'loan', 'renewal', 'circ', 'internal use',
        'in-house', 'in house', 'use count', 'browse', 'activity', 'usage'
    ];

    state.columns.forEach(c => {
        const lower = c.toLowerCase();

        // Skip decision column from being treated as regular metadata or circ
        if (lower === state.decCol.toLowerCase()) return;

        // Auto detect Call Number column if not already set or guessed
        if (!state.detectedCols.call && callGuesses.some(g => lower === g || lower.includes(g))) {
            state.detectedCols.call = c;
            if (!settings.callCol) {
                settings.callCol = c;
            }
        }
        // Auto detect Title
        else if (!state.detectedCols.title && titleGuesses.some(g => lower === g || lower.includes(g))) {
            state.detectedCols.title = c;
        }
        // Auto detect Author
        else if (!state.detectedCols.author && authorGuesses.some(g => lower === g || lower.includes(g))) {
            state.detectedCols.author = c;
        }
        // Auto detect Circulation columns
        else if (circGuesses.some(g => lower.includes(g))) {
            state.detectedCols.circ.push(c);
        }
        // Rest goes to metadata
        else {
            state.detectedCols.meta.push(c);
        }
    });

    // Fallbacks if not detected
    if (!state.detectedCols.title && state.columns.length > 0) {
        state.detectedCols.title = state.columns[0];
    }
    if (!state.detectedCols.author && state.columns.length > 1) {
        state.detectedCols.author = state.columns[1];
    }

    // Build meta and circ lists ensuring we don't duplicate title/author/call column
    const specialCols = [state.detectedCols.title, state.detectedCols.author, settings.callCol || state.detectedCols.call].filter(Boolean);

    state.detectedCols.circ = state.detectedCols.circ.filter(c => !specialCols.includes(c));

    state.detectedCols.meta = state.columns.filter(c => {
        return !specialCols.includes(c) && !state.detectedCols.circ.includes(c) && c !== state.decCol;
    });
}

// CSV Wizard
function setupWizard() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    document.getElementById('wiz-btn-gen-id').addEventListener('click', () => {
        const idCol = 'Generated_ID';
        state.columns.unshift(idCol);
        state.data.forEach((row, i) => row[idCol] = 'ROW_' + (i + 1));
        state.idCol = idCol;
        document.getElementById('wiz-id-col').innerHTML = `<option value="${idCol}">${idCol}</option>`;
    });

    document.getElementById('wiz-btn-start').addEventListener('click', () => {
        state.idCol = document.getElementById('wiz-id-col').value;
        state.decCol = document.getElementById('wiz-dec-col').value;
        if (!state.columns.includes(state.decCol)) {
            state.columns.push(state.decCol);
            state.data.forEach(row => row[state.decCol] = '');
        }
        state.columns.forEach(c => state.visibleCols[c] = true); // All visible by default

        detectColumns();
        saveData();
        document.getElementById('import-wizard').classList.remove('active');
        document.getElementById('tabsNav').style.display = 'flex';
        refreshApp();
    });
}

function handleFile(file) {
    state.originalFilename = file.name.replace(/\.[^/.]+$/, "");
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: function(results) {
            let cols = results.meta.fields || [];
            // Cleanup headers
            cols = cols.map((c, i) => {
                let cleaned = c.trim().replace(/\s+/g, ' ').replace(/^\uFEFF/, '');
                if (!cleaned) cleaned = 'Column_' + i;
                return cleaned;
            });
            // Dedup
            const seen = {};
            cols = cols.map(c => {
                if (seen[c]) {
                    let k = 1;
                    while(seen[c + '_' + k]) k++;
                    c = c + '_' + k;
                }
                seen[c] = true;
                return c;
            });

            // Map data
            state.data = results.data.map(row => {
                let newRow = {};
                cols.forEach((c, i) => {
                    let val = row[results.meta.fields[i]];
                    newRow[c] = typeof val === 'string' ? val.trim() : val;
                });
                return newRow;
            });
            state.columns = cols;

            if (!settings.callCol) {
                const callGuesses = ['call #', 'call number', 'call_number', 'callno', 'call'];
                for (let c of cols) {
                    if (callGuesses.includes(c.toLowerCase())) {
                        settings.callCol = c;
                        break;
                    }
                }
            }

            document.getElementById('wiz-row-count').textContent = state.data.length;
            const sel = document.getElementById('wiz-id-col');
            sel.innerHTML = cols.map(c => `<option value="${c}">${c}</option>`).join('');

            document.getElementById('wizard-step-1').classList.remove('active');
            document.getElementById('wizard-step-2').classList.add('active');
        }
    });
}

function populateSelects() {
    const cols = state.columns;
    const opts = cols.map(c => `<option value="${c}">${c}</option>`).join('');

    // Sort logic dropdowns
    document.getElementById('queue-sort').innerHTML = opts;

    // Call number col setting
    const callColSelect = document.getElementById('set-call-col');
    callColSelect.innerHTML = `<option value="">(None)</option>` + opts;
    callColSelect.value = settings.callCol || '';

    // Wheel filter column
    const wheelFilterCol = document.getElementById('wheel-filter-col');
    if (wheelFilterCol) {
        wheelFilterCol.innerHTML = `<option value="">Filter Column...</option>` + opts;
    }

    // Default queue-sort to the call column if available, otherwise just use idCol
    if (settings.callCol && cols.includes(settings.callCol)) {
        document.getElementById('queue-sort').value = settings.callCol;
    }
}

// Dashboard
function updateDashboard() {
    let k=0, d=0, r=0, s=0, u=0;
    state.data.forEach(row => {
        const dec = row[state.decCol];
        if (dec === 'keep') k++;
        else if (dec === 'ditch') d++;
        else if (dec === 'review') r++;
        else if (dec === 'skip') s++;
        else u++;
    });

    document.getElementById('stat-keep').textContent = k;
    document.getElementById('stat-ditch').textContent = d;
    document.getElementById('stat-review').textContent = r;
    document.getElementById('stat-skip').textContent = s + u;

    const decided = k + d + r + s;
    const pct = state.data.length ? Math.round((decided / state.data.length) * 100) : 0;
    document.getElementById('stat-progress-text').textContent = pct + '%';
    document.getElementById('stat-progress-fill').style.width = pct + '%';

    document.getElementById('btn-export-dashboard').onclick = () => doExport('Full', state.data);
}

// Drawers
function setupDrawers() {
    const ld = document.getElementById('left-drawer');
    const rd = document.getElementById('right-drawer');
    document.getElementById('btn-left-drawer').onclick = () => ld.classList.add('open');
    document.getElementById('dismiss-left-drawer').onclick = () => ld.classList.remove('open');
    document.getElementById('btn-right-drawer').onclick = () => rd.classList.add('open');
    document.getElementById('dismiss-right-drawer').onclick = () => rd.classList.remove('open');

    // Sort logic
    document.getElementById('queue-sort').addEventListener('change', () => {
        buildQueue();
    });
    document.getElementById('queue-filter').addEventListener('change', () => {
        buildQueue();
    });

    // Wheel search option
    const wheelSearch = document.getElementById('wheel-search');
    if (wheelSearch) {
        wheelSearch.addEventListener('input', () => {
            renderWheel();
        });
    }

    // Wheel custom column value filter
    const wheelFilterCol = document.getElementById('wheel-filter-col');
    const wheelFilterVal = document.getElementById('wheel-filter-val');
    if (wheelFilterCol && wheelFilterVal) {
        wheelFilterCol.addEventListener('change', () => {
            renderWheel();
        });
        wheelFilterVal.addEventListener('input', () => {
            renderWheel();
        });
    }
}

function renderLeftDrawerToggles() {
    const container = document.getElementById('card-col-toggles');
    container.innerHTML = state.columns.map(c => {
        if (c === state.idCol || c === state.decCol) return ''; // Hide core IDs/Decisions from general toggles
        return `
            <div class="toggle-item" draggable="true" data-col="${c}">
                <span class="drag-handle">☰</span>
                <input type="checkbox" id="chk-col-${c}" ${state.visibleCols[c]?'checked':''}>
                <label for="chk-col-${c}">${c}</label>
            </div>
        `;
    }).join('');

    container.querySelectorAll('input[type=checkbox]').forEach(chk => {
        chk.onchange = (e) => {
            const col = e.target.id.replace('chk-col-', '');
            state.visibleCols[col] = e.target.checked;
            saveData();
            renderCard();
        };
    });

    // Simple Drag & Drop sorting for columns list
    let dragEl = null;
    container.querySelectorAll('.toggle-item').forEach(item => {
        item.addEventListener('dragstart', (e) => { dragEl = e.currentTarget; e.dataTransfer.effectAllowed = 'move'; });
        item.addEventListener('dragover', (e) => { e.preventDefault(); });
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const target = e.currentTarget;
            if(dragEl && target !== dragEl) {
                // Reorder in state
                const colDrag = dragEl.dataset.col;
                const colTarget = target.dataset.col;
                const idxDrag = state.columns.indexOf(colDrag);
                const idxTarget = state.columns.indexOf(colTarget);

                state.columns.splice(idxDrag, 1);
                state.columns.splice(idxTarget, 0, colDrag);

                saveData();
                renderLeftDrawerToggles();
                renderCard();
                renderTable();
            }
        });
    });
}

// Queue Building
function buildQueue() {
    const filter = document.getElementById('queue-filter').value;
    const sortCol = document.getElementById('queue-sort').value;

    // Create index array
    let q = [];
    state.data.forEach((row, idx) => {
        const dec = row[state.decCol];
        if (filter === 'undecided' && dec && dec !== 'skip') return;
        if (filter === 'decided' && (!dec || dec === 'skip')) return;
        q.push(idx);
    });

    // Sorting
    if (sortCol) {
        q.sort((idxA, idxB) => {
            const valA = state.data[idxA][sortCol] || '';
            const valB = state.data[idxB][sortCol] || '';

            if (sortCol === settings.callCol) {
                return compareLC(valA, valB);
            }

            // Standard alphanumeric sort
            return String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    state.queue = q;
    state.currentIndex = 0; // reset
    renderCard();
    renderWheel();
    renderLeftDrawerToggles();
}

// Scroll Wheel
let currentWheelQueueHash = '';
let wheelScrollTimeout = null;
let isWheelScrollingByCode = false;

function renderWheel() {
    const wheel = document.getElementById('call-number-wheel');
    const sortCol = document.getElementById('queue-sort').value || state.idCol;
    const searchVal = document.getElementById('wheel-search')?.value.toLowerCase().trim() || '';
    const filterCol = document.getElementById('wheel-filter-col')?.value || '';
    const filterVal = document.getElementById('wheel-filter-val')?.value.toLowerCase().trim() || '';
    const decisionsStr = state.queue.map(idx => state.data[idx][state.decCol] || '').join(',');
    const qHash = state.queue.join(',') + ':' + sortCol + ':' + searchVal + ':' + decisionsStr + ':' + filterCol + ':' + filterVal;

    if (currentWheelQueueHash !== qHash) {
        currentWheelQueueHash = qHash;

        const filteredQueueIdxs = [];
        state.queue.forEach((idx, qIdx) => {
            const callVal = String(state.data[idx][sortCol] || '').toLowerCase();
            const titleCol = state.detectedCols?.title || state.columns[0];
            const titleVal = String(state.data[idx][titleCol] || '').toLowerCase();

            let match = !searchVal || callVal.includes(searchVal) || titleVal.includes(searchVal);

            if (match && filterCol && filterVal) {
                const cellVal = String(state.data[idx][filterCol] || '').toLowerCase();
                match = cellVal.includes(filterVal);
            }

            if (match) {
                filteredQueueIdxs.push({ idx, qIdx });
            }
        });

        const pad = `<div style="height: calc(50vh - 120px)"></div>`;
        wheel.innerHTML = pad + filteredQueueIdxs.map(({ idx, qIdx }) => {
            const dec = state.data[idx][state.decCol];
            let itemStyle = '';
            let colorVal = '';
            if (dec === 'keep') colorVal = settings.colors.right;
            else if (dec === 'ditch') colorVal = settings.colors.left;
            else if (dec === 'review') colorVal = settings.colors.up;
            else if (dec === 'skip') colorVal = settings.colors.down;

            if (colorVal) {
                itemStyle = `color: ${colorVal}; border-left: 4px solid ${colorVal}; padding-left: 12px;`;
            }

            return `
                <div class="wheel-item" data-qidx="${qIdx}" style="${itemStyle}">
                    ${state.data[idx][sortCol] || '<em>Blank</em>'}
                </div>
            `;
        }).join('') + pad;

        wheel.querySelectorAll('.wheel-item').forEach(item => {
            item.addEventListener('click', (e) => {
                state.currentIndex = parseInt(e.currentTarget.dataset.qidx);
                updateActiveWheelItem(true);
                renderCard();
            });
        });

        wheel.onscroll = () => {
            if (isWheelScrollingByCode) return;
            clearTimeout(wheelScrollTimeout);
            wheelScrollTimeout = setTimeout(() => {
                const wheelRect = wheel.getBoundingClientRect();
                const wheelCenter = wheelRect.top + wheelRect.height / 2;
                let closestItem = null;
                let minDiff = Infinity;

                wheel.querySelectorAll('.wheel-item').forEach(item => {
                    const rect = item.getBoundingClientRect();
                    const itemCenter = rect.top + rect.height / 2;
                    const diff = Math.abs(wheelCenter - itemCenter);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestItem = item;
                    }
                });

                if (closestItem && minDiff < 40) {
                    const newIdx = parseInt(closestItem.dataset.qidx);
                    if (newIdx !== state.currentIndex) {
                        state.currentIndex = newIdx;
                        updateActiveWheelItem(false);
                        renderCard();
                    }
                }
            }, 100);
        };
    }

    updateActiveWheelItem(true);
}

function updateActiveWheelItem(scrollToItem = false) {
    const wheel = document.getElementById('call-number-wheel');

    wheel.querySelectorAll('.wheel-item').forEach(item => {
        if (parseInt(item.dataset.qidx) === state.currentIndex) {
            item.classList.add('active');
            if (scrollToItem) {
                isWheelScrollingByCode = true;
                item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                clearTimeout(wheel.codeScrollTimer);
                wheel.codeScrollTimer = setTimeout(() => {
                    isWheelScrollingByCode = false;
                }, 500); // Allow time for smooth scroll to settle
            }
        } else {
            item.classList.remove('active');
        }
    });
}

// Swiper
let isDragging = false, startX = 0, startY = 0, currentX = 0, currentY = 0;

function setupSwiper() {
    cardContainer.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);

    cardContainer.addEventListener('touchstart', handleDragStart, {passive: false});
    document.addEventListener('touchmove', handleDragMove, {passive: false});
    document.addEventListener('touchend', handleDragEnd);

    document.getElementById('btn-swipe-right').onclick = () => swipeCard('right');
    document.getElementById('btn-swipe-left').onclick = () => swipeCard('left');
    document.getElementById('btn-swipe-up').onclick = () => swipeCard('up');
    document.getElementById('btn-swipe-down').onclick = () => swipeCard('down');

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (document.getElementById('swiper-view').style.display !== 'flex') return;
        if (e.key === 'ArrowRight') swipeCard('right');
        else if (e.key === 'ArrowLeft') swipeCard('left');
        else if (e.key === 'ArrowUp') swipeCard('up');
        else if (e.key === 'ArrowDown') swipeCard('down');
    });
}

let swipeIntent = null; // 'horizontal', 'vertical', or 'scroll'

function handleDragStart(e) {
    if (state.currentIndex >= state.queue.length) return;

    // Swipe interaction safety: ignore drags initiating from tab buttons or tab headers
    if (e.target.closest('.card-tabs-header') || e.target.closest('.card-tab-btn')) {
        return;
    }

    isDragging = true;
    swipeIntent = null;
    cardContainer.classList.remove('animating');
    const pos = e.type.includes('touch') ? e.touches[0] : e;
    startX = pos.clientX;
    startY = pos.clientY;
}

function handleDragMove(e) {
    if (!isDragging) return;
    const pos = e.type.includes('touch') ? e.touches[0] : e;
    currentX = pos.clientX - startX;
    currentY = pos.clientY - startY;

    if (!swipeIntent) {
        if (Math.abs(currentX) > 5 || Math.abs(currentY) > 5) {
            if (Math.abs(currentX) > Math.abs(currentY)) {
                swipeIntent = 'horizontal';
            } else {
                const listEl = document.querySelector('.card-fields-list');
                if (listEl && listEl.contains(e.target) && listEl.scrollHeight > listEl.clientHeight) {
                    const isAtTop = listEl.scrollTop === 0;
                    const isAtBottom = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 1;
                    if ((isAtTop && currentY > 0) || (isAtBottom && currentY < 0)) {
                        swipeIntent = 'vertical';
                    } else {
                        swipeIntent = 'scroll';
                    }
                } else {
                    swipeIntent = 'vertical';
                }
            }
        }
    }

    if (swipeIntent === 'scroll') return;

    if (swipeIntent) {
        if (e.cancelable) e.preventDefault();
        const rotate = currentX * 0.05;
        cardContainer.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotate}deg)`;

        // Opacities
        badgeRight.style.opacity = currentX > 50 ? Math.min(1, (currentX-50)/100) : 0;
        badgeLeft.style.opacity = currentX < -50 ? Math.min(1, Math.abs(currentX+50)/100) : 0;
        badgeUp.style.opacity = currentY < -50 ? Math.min(1, Math.abs(currentY+50)/100) : 0;
        badgeDown.style.opacity = currentY > 50 ? Math.min(1, (currentY-50)/100) : 0;
    }
}

function handleDragEnd() {
    if (!isDragging) return;
    isDragging = false;

    if (swipeIntent === 'scroll') {
        swipeIntent = null;
        return;
    }

    cardContainer.classList.add('animating');

    // Threshold check
    if (swipeIntent === 'horizontal') {
        if (currentX > 100) {
            swipeCard('right');
        } else if (currentX < -100) {
            swipeCard('left');
        } else {
            cardContainer.style.transform = '';
            resetBadges();
        }
    } else if (swipeIntent === 'vertical') {
        if (currentY < -100) {
            swipeCard('up');
        } else if (currentY > 100) {
            swipeCard('down');
        } else {
            cardContainer.style.transform = '';
            resetBadges();
        }
    } else {
        cardContainer.style.transform = '';
        resetBadges();
    }

    swipeIntent = null;
}

function swipeCard(direction) {
    if (state.currentIndex >= state.queue.length) return;
    const idx = state.queue[state.currentIndex];

    // Visual fly-away animation
    cardContainer.classList.add('animating');
    if (direction === 'right') cardContainer.style.transform = 'translate(600px, 0) rotate(30deg)';
    else if (direction === 'left') cardContainer.style.transform = 'translate(-600px, 0) rotate(-30deg)';
    else if (direction === 'up') cardContainer.style.transform = 'translate(0, -600px)';
    else if (direction === 'down') cardContainer.style.transform = 'translate(0, 600px)';

    let decVal = '';
    if (direction === 'right') decVal = 'keep';
    else if (direction === 'left') decVal = 'ditch';
    else if (direction === 'up') decVal = 'review';
    else if (direction === 'down') decVal = 'skip';

    state.data[idx][state.decCol] = decVal;

    setTimeout(() => {
        state.currentIndex++;
        saveData();
        updateDashboard();
        renderTable();

        // Reset position for next card instantly
        cardContainer.classList.remove('animating');
        cardContainer.style.transform = '';
        resetBadges();

        renderCard();
        renderWheel();
    }, 200);
}

function resetBadges() {
    badgeRight.style.opacity = 0;
    badgeLeft.style.opacity = 0;
    badgeUp.style.opacity = 0;
    badgeDown.style.opacity = 0;
}

window.switchCardTab = function(tabName) {
    state.activeCardTab = tabName;
    renderCard();
};

function renderCard() {
    if (state.currentIndex >= state.queue.length) {
        cardContainer.style.display = 'none';
        document.getElementById('swiper-empty').style.display = 'block';
        return;
    }
    cardContainer.style.display = 'flex';
    document.getElementById('swiper-empty').style.display = 'none';

    const row = state.data[state.queue[state.currentIndex]];
    const content = document.getElementById('card-content');

    // Prominent book headers
    const titleCol = state.detectedCols?.title || state.columns[0];
    const authorCol = state.detectedCols?.author || state.columns[1];
    const callCol = settings.callCol || state.detectedCols?.call;

    const titleVal = row[titleCol] || 'Unknown Title';
    const authorVal = row[authorCol] || 'Unknown Author';
    const callVal = row[callCol] || '';

    // Layout of the card: Hero header + tab switcher + fields list
    let html = `
        <div class="card-hero">
            <div class="card-hero-title">${titleVal}</div>
            <div class="card-hero-author">${authorVal !== 'Unknown Author' ? 'by ' + authorVal : ''}</div>
            ${callVal ? `<div class="card-hero-call"><span class="hero-call-badge">${callVal}</span></div>` : ''}
        </div>
        <div class="card-tabs-header">
            <button class="card-tab-btn ${state.activeCardTab === 'circ' ? 'active' : ''}" onclick="switchCardTab('circ')">Circulation</button>
            <button class="card-tab-btn ${state.activeCardTab === 'meta' ? 'active' : ''}" onclick="switchCardTab('meta')">Metadata</button>
        </div>
        <div class="card-fields-list">
    `;

    if (state.activeCardTab === 'circ') {
        const circCols = (state.detectedCols?.circ || []).filter(c => state.visibleCols[c]);
        if (circCols.length === 0) {
            html += `<div class="empty-tab-msg">No circulation metrics detected or visible.</div>`;
        } else {
            circCols.forEach(c => {
                html += `
                    <div class="card-field">
                        <div class="card-field-label">${c}</div>
                        <div class="card-field-val">${row[c] || '0'}</div>
                    </div>
                `;
            });
        }
    } else {
        const metaCols = (state.detectedCols?.meta || []).filter(c => state.visibleCols[c]);
        if (metaCols.length === 0) {
            html += `<div class="empty-tab-msg">No additional metadata fields visible.</div>`;
        } else {
            metaCols.forEach(c => {
                html += `
                    <div class="card-field">
                        <div class="card-field-label">${c}</div>
                        <div class="card-field-val">${row[c] || ''}</div>
                    </div>
                `;
            });
        }
    }

    html += `</div>`;
    content.innerHTML = html;
}

// Table
function setupFilters() {
    // Table search & paging
    document.getElementById('table-search').addEventListener('input', () => { state.tablePage = 1; renderTable(); });
    document.getElementById('dt-prev').onclick = () => { if(state.tablePage > 1) { state.tablePage--; renderTable(); } };
    document.getElementById('dt-next').onclick = () => { state.tablePage++; renderTable(); };
    document.getElementById('btn-table-export').onclick = () => {
        // export filtered table view
        const q = document.getElementById('table-search').value.toLowerCase();
        let exportData = state.data;
        if(q) {
            exportData = state.data.filter(row => {
                return state.columns.some(c => String(row[c] || '').toLowerCase().includes(q));
            });
        }
        doExport('Filtered_Table', exportData);
    };
}

function renderTable() {
    const q = document.getElementById('table-search').value.toLowerCase();
    let filtered = state.data;
    if (q) {
        filtered = state.data.filter(row => {
            return state.columns.some(c => String(row[c] || '').toLowerCase().includes(q));
        });
    }

    const totalRows = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / state.tableRowsPerPage));
    if (state.tablePage > totalPages) state.tablePage = totalPages;

    const start = (state.tablePage - 1) * state.tableRowsPerPage;
    const paginated = filtered.slice(start, start + state.tableRowsPerPage);

    document.getElementById('dt-page-info').textContent = `Page ${state.tablePage} of ${totalPages} (Total: ${totalRows})`;

    const thead = document.getElementById('dt-head');
    thead.innerHTML = `<th>Actions</th>` + state.columns.map(c => `<th>${c}</th>`).join('');

    const tbody = document.getElementById('dt-body');
    tbody.innerHTML = paginated.map(row => {
        const id = row[state.idCol];
        const dec = row[state.decCol];
        let decHtml = `<select onchange="updateRowDec('${id}', this.value)">
            <option value="" ${!dec?'selected':''}>-</option>
            <option value="keep" ${dec==='keep'?'selected':''}>Keep</option>
            <option value="ditch" ${dec==='ditch'?'selected':''}>Ditch</option>
            <option value="review" ${dec==='review'?'selected':''}>Review</option>
            <option value="skip" ${dec==='skip'?'selected':''}>Skip</option>
        </select>`;

        return `<tr>
            <td>${decHtml}</td>
            ${state.columns.map(c => `<td>${row[c] !== undefined ? row[c] : ''}</td>`).join('')}
        </tr>`;
    }).join('');
}

window.updateRowDec = function(idVal, newDec) {
    const row = state.data.find(r => r[state.idCol] === idVal);
    if(row) {
        row[state.decCol] = newDec;
        saveData();
        updateDashboard();
        buildQueue();
    }
}

// Settings & Export
function setupSettings() {
    const inputs = ['right', 'left', 'up', 'down'];
    inputs.forEach(dir => {
        document.getElementById(`set-lbl-${dir}`).addEventListener('change', e => {
            settings.labels[dir] = e.target.value; saveData(); applySettings();
        });
        document.getElementById(`set-col-${dir}`).addEventListener('change', e => {
            settings.colors[dir] = e.target.value; saveData(); applySettings();
        });
    });

    document.getElementById('set-dec-col').addEventListener('change', e => {
        const newCol = e.target.value.trim();
        if(newCol && newCol !== state.decCol) {
            // Rename in cols array
            const idx = state.columns.indexOf(state.decCol);
            if(idx > -1) state.columns[idx] = newCol;
            // Rename in data
            state.data.forEach(r => {
                r[newCol] = r[state.decCol];
                delete r[state.decCol];
            });
            state.decCol = newCol;
            saveData();
            refreshApp();
        }
    });

    document.getElementById('set-call-col').addEventListener('change', e => {
        settings.callCol = e.target.value;
        saveData();
        buildQueue();
    });

    document.getElementById('set-export-pattern').addEventListener('input', e => {
        settings.exportPattern = e.target.value;
        saveData();
        updateExportPreview();
    });

    // Theme selector
    document.getElementById('set-theme').addEventListener('change', e => {
        settings.theme = e.target.value;
        saveData();
        applySettings();
    });

    document.getElementById('btn-reset-app').onclick = async () => {
        if(confirm('Are you sure you want to delete all local data? This cannot be undone.')) {
            await idbClear();
            localStorage.clear();
            location.reload();
        }
    };

    document.getElementById('btn-save-snapshot').onclick = async () => {
        const name = document.getElementById('snapshot-name').value.trim() || new Date().toLocaleString();
        const snaps = await idbGet(VER + 'snapshots') || {};
        snaps[name] = { state, settings };
        await idbSet(VER + 'snapshots', snaps);
        populateSnapshots();
        document.getElementById('snapshot-name').value = '';
    };

    document.getElementById('btn-export-project').onclick = () => {
        const projectData = { state, settings, version: VER };
        const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.download = `lctriage_project_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    document.getElementById('import-project-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                if (data.state && data.settings) {
                    state = data.state;
                    settings = data.settings;
                    await saveData();
                    alert('Project loaded successfully!');
                    location.reload();
                } else {
                    alert('Invalid project file structure.');
                }
            } catch(ex) {
                alert('Failed to parse file: ' + ex.message);
            }
        };
        reader.readAsText(file);
    });
}

function updateExportPreview() {
    const pat = settings.exportPattern;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');

    let out = pat
        .replace('{original_filename}', state.originalFilename || 'dataset')
        .replace('{subset_name}', 'Keep')
        .replace('{decision_label}', 'Keep')
        .replace('{date}', dateStr)
        .replace('{time}', timeStr)
        .replace('{row_count}', '123');

    document.getElementById('set-export-preview').textContent = out + '.csv';
}

async function populateSnapshots() {
    const list = document.getElementById('snapshot-list');
    const snaps = await idbGet(VER + 'snapshots') || {};
    list.innerHTML = Object.keys(snaps).map(k => `
        <li>
            <span>${k}</span>
            <div style="display:flex; gap:0.25rem;">
                <button class="btn" style="padding:0.25rem 0.5rem;" onclick="loadSnapshot('${k}')">Load</button>
                <button class="btn btn-ditch" style="padding:0.25rem 0.5rem;" onclick="deleteSnapshot('${k}')">Del</button>
            </div>
        </li>
    `).join('');
}

window.loadSnapshot = async function(k) {
    if(confirm(`Load snapshot "${k}"? Current unsaved progress will be lost.`)) {
        const snaps = await idbGet(VER + 'snapshots') || {};
        if(snaps[k]) {
            state = snaps[k].state;
            settings = snaps[k].settings;
            await saveData();
            location.reload();
        }
    }
}

window.deleteSnapshot = async function(k) {
    if(confirm(`Delete snapshot "${k}"?`)) {
        const snaps = await idbGet(VER + 'snapshots') || {};
        delete snaps[k];
        await idbSet(VER + 'snapshots', snaps);
        populateSnapshots();
    }
}

function doExport(subsetName, dataArr) {
    const pat = settings.exportPattern;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');

    let filename = pat
        .replace('{original_filename}', state.originalFilename || 'dataset')
        .replace('{subset_name}', subsetName)
        .replace('{decision_label}', subsetName)
        .replace('{date}', dateStr)
        .replace('{time}', timeStr)
        .replace('{row_count}', dataArr.length) + '.csv';

    // Generate CSV
    const csv = Papa.unparse(dataArr);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
