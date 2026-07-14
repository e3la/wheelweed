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
    tableRowsPerPage: 50
};

let settings = {
    labels: { right: 'Keep', left: 'Ditch', up: 'Review', down: 'Skip' },
    colors: { right: '#22c55e', left: '#ef4444', up: '#eab308', down: '#94a3b8' },
    exportPattern: '{original_filename}_{subset_name}_{date}',
    callCol: ''
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

// Storage (IndexedDB)
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

// CSV Wizard
function setupWizard() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault(); dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', e => {
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
}

function renderLeftDrawerToggles() {
    const cont = document.getElementById('card-col-toggles');
    cont.innerHTML = state.columns.map((c, i) => `
        <label class="toggle-item" draggable="true" data-index="${i}">
            <input type="checkbox" ${state.visibleCols[c] ? 'checked' : ''} data-col="${c}">
            <span class="drag-handle">☰</span>
            ${c}
        </label>
    `).join('');

    cont.querySelectorAll('input').forEach(chk => {
        chk.addEventListener('change', (e) => {
            state.visibleCols[e.target.dataset.col] = e.target.checked;
            saveData();
            renderCard();
        });
    });

    let draggedIdx = null;
    cont.querySelectorAll('.toggle-item').forEach(item => {
        item.addEventListener('dragstart', e => {
            draggedIdx = +e.currentTarget.dataset.index;
            e.currentTarget.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        item.addEventListener('drop', e => {
            e.preventDefault();
            const targetIdx = +e.currentTarget.dataset.index;
            if (draggedIdx !== null && draggedIdx !== targetIdx) {
                const colToMove = state.columns.splice(draggedIdx, 1)[0];
                state.columns.splice(targetIdx, 0, colToMove);
                saveData();
                renderLeftDrawerToggles();
                renderCard();
                renderTable();
            }
        });
        item.addEventListener('dragend', e => {
            e.currentTarget.style.opacity = '1';
        });
    });
}

// Queue & Wheel
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

    if (sortCol) {
        if (sortCol === settings.callCol) {
            q.sort((a, b) => compareLC(state.data[a][sortCol], state.data[b][sortCol]));
        } else {
            q.sort((a, b) => {
                const va = state.data[a][sortCol] || '';
                const vb = state.data[b][sortCol] || '';
                return String(va).localeCompare(String(vb), undefined, {numeric: true});
            });
        }
    }

    state.queue = q;
    state.currentIndex = 0;
    renderLeftDrawerToggles();
    renderCard();
    renderWheel();
}

let currentWheelQueueHash = '';
let wheelScrollTimeout = null;
let isWheelScrollingByCode = false;

function renderWheel() {
    const wheel = document.getElementById('call-number-wheel');
    const sortCol = document.getElementById('queue-sort').value || state.idCol;
    const qHash = state.queue.join(',') + ':' + sortCol;

    if (currentWheelQueueHash !== qHash) {
        currentWheelQueueHash = qHash;

        // Remove old event listener by replacing node if necessary, but here we can just clear innerHTML and add new event listener safely if we just bind it once or use a named function.
        // Better: wheel.onscroll = ...

        const pad = `<div style="height: calc(50vh - 120px)"></div>`;
        wheel.innerHTML = pad + state.queue.map((idx, qIdx) => `
            <div class="wheel-item" data-qidx="${qIdx}">
                ${state.data[idx][sortCol] || '<em>Blank</em>'}
            </div>
        `).join('') + pad;

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
                const content = document.getElementById('card-content');
                if (content.contains(e.target) && content.scrollHeight > content.clientHeight) {
                    const isAtTop = content.scrollTop === 0;
                    const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;
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
    cardContainer.classList.add('animating');

    const THRESH = 100;
    if (currentX > THRESH) swipeCard('right');
    else if (currentX < -THRESH) swipeCard('left');
    else if (currentY < -THRESH) swipeCard('up');
    else if (currentY > THRESH) swipeCard('down');
    else {
        // Snap back
        cardContainer.style.transform = '';
        resetBadges();
    }
    currentX = 0; currentY = 0;
}

function swipeCard(direction) {
    if (state.currentIndex >= state.queue.length) return;

    const idx = state.queue[state.currentIndex];

    // Visual exit
    const exitX = direction === 'right' ? 1000 : direction === 'left' ? -1000 : 0;
    const exitY = direction === 'down' ? 1000 : direction === 'up' ? -1000 : 0;
    cardContainer.style.transform = `translate(${exitX}px, ${exitY}px) rotate(${exitX*0.05}deg)`;

    // Record decision
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

    let html = '';
    state.columns.forEach(c => {
        if (state.visibleCols[c]) {
            html += `<div class="card-field">
                <div class="card-field-label">${c}</div>
                <div class="card-field-val">${row[c] || ''}</div>
            </div>`;
        }
    });
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
            exportData = state.data.filter(row => state.columns.some(c => (row[c]||'').toLowerCase().includes(q)));
        }
        doExport('TableView', exportData);
    };
}

function renderTable() {
    const q = document.getElementById('table-search').value.toLowerCase();
    let filtered = state.data;
    if (q) {
        filtered = state.data.filter(row =>
            state.columns.some(c => (row[c] || '').toLowerCase().includes(q))
        );
    }

    const start = (state.tablePage - 1) * state.tableRowsPerPage;
    const paginated = filtered.slice(start, start + state.tableRowsPerPage);

    document.getElementById('dt-page-info').textContent = `Page ${state.tablePage} of ${Math.ceil(filtered.length / state.tableRowsPerPage) || 1}`;

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
            ${state.columns.map(c => `<td>${row[c] || ''}</td>`).join('')}
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
            } catch (err) {
                alert('Error parsing project file.');
                console.error(err);
            }
        };
        reader.readAsText(file);
    });
}

function updateExportPreview() {
    const p = settings.exportPattern;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g,'-');

    let res = p.replace('{original_filename}', state.originalFilename)
               .replace('{subset_name}', 'Full')
               .replace('{decision_label}', 'All')
               .replace('{date}', dateStr)
               .replace('{time}', timeStr)
               .replace('{row_count}', state.data.length);
    document.getElementById('set-export-preview').textContent = res + '.csv';
}

function doExport(subsetName, dataArr) {
    const csv = Papa.unparse(dataArr);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    let filename = settings.exportPattern
               .replace('{original_filename}', state.originalFilename)
               .replace('{subset_name}', subsetName)
               .replace('{decision_label}', 'Export')
               .replace('{date}', now.toISOString().split('T')[0])
               .replace('{time}', now.toTimeString().split(' ')[0].replace(/:/g,'-'))
               .replace('{row_count}', dataArr.length) + '.csv';

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function populateSnapshots() {
    const snaps = await idbGet(VER + 'snapshots') || {};
    const ul = document.getElementById('snapshot-list');
    ul.innerHTML = Object.keys(snaps).map(k => `
        <li>
            <span>${k}</span>
            <div>
                <button class="btn" onclick="loadSnapshot('${k}')">Load</button>
                <button class="btn btn-ditch" onclick="deleteSnapshot('${k}')">Del</button>
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
