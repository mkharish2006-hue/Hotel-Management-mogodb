/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  HotelHub — Frontend Application                            ║
 * ║  Navigation, API calls, toasts, modals, charts, PDF export  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ═══════════════════════════════════════════════════════════════════
// GLOBALS
// ═══════════════════════════════════════════════════════════════════

const API = '';
let currentPage = 'dashboard';
let editingRoomId = null;
let userRole = 'user';  // set from server-rendered template

// ═══════════════════════════════════════════════════════════════════
// TOAST SYSTEM
// ═══════════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };

    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ═══════════════════════════════════════════════════════════════════
// LOADING
// ═══════════════════════════════════════════════════════════════════

function showLoading() { document.getElementById('loadingOverlay').classList.add('visible'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.remove('visible'); }

// ═══════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════

function navigateTo(page) {
    currentPage = page;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Show/hide sections
    document.querySelectorAll('.page-section').forEach(s => {
        s.classList.toggle('active', s.id === `page-${page}`);
    });

    // Update header
    const headers = {
        dashboard: { t: '📊 Dashboard', d: 'Overview of your hotel operations' },
        rooms:     { t: '🛏️ Room Management', d: 'Add, edit, and manage your rooms' },
        bookings:  { t: '📋 Bookings', d: 'Create and manage guest bookings' },
        history:   { t: '📜 Booking History', d: 'View past completed bookings' },
        analytics: { t: '📈 Analytics', d: 'Revenue and room usage insights' }
    };
    const h = headers[page] || headers.dashboard;
    document.getElementById('pageTitle').textContent = h.t;
    document.getElementById('pageDesc').textContent = h.d;

    // Load page data
    const loaders = {
        dashboard: loadDashboard,
        rooms: loadRooms,
        bookings: loadBookings,
        history: loadHistory,
        analytics: loadAnalytics
    };
    if (loaders[page]) loaders[page]();

    // Close mobile sidebar
    document.querySelector('.sidebar')?.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════

async function loadDashboard() {
    try {
        const res = await fetch(`${API}/api/dashboard`);
        if (res.status === 401) return logout();
        const d = await res.json();

        animateCounter('statTotal', d.total_rooms);
        animateCounter('statAvailable', d.available_rooms);
        animateCounter('statBooked', d.booked_rooms);
        animateCounter('statMaint', d.maintenance_rooms);

        renderRecentBookings(d.recent_bookings);
    } catch (err) {
        showToast('Failed to load dashboard', 'error');
    }
}

function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const dur = 700, start = performance.now();
    function tick(now) {
        const p = Math.min((now - start) / dur, 1);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * e);
        if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

function renderRecentBookings(bookings) {
    const tbody = document.getElementById('recentBookingsBody');
    if (!tbody) return;

    if (!bookings || bookings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:36px;color:var(--text-muted);">No recent bookings</td></tr>`;
        return;
    }

    tbody.innerHTML = bookings.map(b => `
        <tr>
            <td class="text-bold">${esc(b.customer_name)}</td>
            <td>🚪 ${esc(b.room_no)}</td>
            <td><span class="badge badge-${typeBadge(b.room_type)}">${esc(b.room_type || 'N/A')}</span></td>
            <td>${esc(b.check_in)}</td>
            <td>${esc(b.check_out)}</td>
        </tr>
    `).join('');
}

// ═══════════════════════════════════════════════════════════════════
// ROOMS
// ═══════════════════════════════════════════════════════════════════

async function loadRooms() {
    const type = document.getElementById('filterType')?.value || 'all';
    const status = document.getElementById('filterStatus')?.value || 'all';
    const search = document.getElementById('searchRoom')?.value || '';

    try {
        let url = `${API}/api/rooms?type=${type}&status=${status}&search=${encodeURIComponent(search)}`;
        const res = await fetch(url);
        if (res.status === 401) return logout();
        const rooms = await res.json();
        renderRoomsTable(rooms);
    } catch (err) {
        showToast('Failed to load rooms', 'error');
    }
}

function renderRoomsTable(rooms) {
    const tbody = document.getElementById('roomsTableBody');
    if (!rooms || rooms.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🏨</div><p>No rooms found</p></div></td></tr>`;
        return;
    }

    const isAdmin = userRole === 'admin';
    tbody.innerHTML = rooms.map(r => `
        <tr>
            <td class="text-bold">🚪 ${esc(r.room_no)}</td>
            <td><span class="badge badge-${typeBadge(r.type)}">${esc(r.type)}</span></td>
            <td class="text-price">₹${Number(r.price).toLocaleString()}</td>
            <td><span class="badge badge-${r.status}">${statusIcon(r.status)} ${r.status}</span></td>
            <td>
                ${isAdmin ? `
                <div class="action-btns">
                    <button class="btn btn-ghost btn-sm" onclick="openEditModal('${r._id}','${esc(r.room_no)}','${esc(r.type)}',${r.price},'${r.status}')" title="Edit">✏️</button>
                    <button class="btn btn-ghost btn-sm" onclick="deleteRoom('${r._id}','${esc(r.room_no)}')" title="Delete" style="color:var(--rose);">🗑️</button>
                </div>` : '—'}
            </td>
        </tr>
    `).join('');
}

async function addRoom(e) {
    e.preventDefault();
    const btn = document.getElementById('addRoomBtn');
    const roomNo = document.getElementById('roomNo').value.trim();
    const roomType = document.getElementById('roomType').value;
    const roomPrice = document.getElementById('roomPrice').value;

    if (!roomNo || !roomType || !roomPrice) { showToast('Fill in all fields', 'error'); return; }
    if (parseFloat(roomPrice) <= 0) { showToast('Price must be > 0', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Adding...';

    try {
        const res = await fetch(`${API}/api/rooms`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ room_no: roomNo, type: roomType, price: parseFloat(roomPrice) })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, 'success');
            document.getElementById('addRoomForm').reset();
            loadRooms();
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) {
        showToast('Server error', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '➕ Add Room';
    }
}

async function deleteRoom(id, no) {
    if (!confirm(`Delete Room ${no}?`)) return;
    showLoading();
    try {
        const res = await fetch(`${API}/api/rooms/${id}`, { method: 'DELETE' });
        const data = await res.json();
        res.ok ? showToast(data.message, 'success') : showToast(data.error, 'error');
        loadRooms();
    } catch (err) {
        showToast('Delete failed', 'error');
    } finally { hideLoading(); }
}

// ── Edit Modal ──

function openEditModal(id, no, type, price, status) {
    editingRoomId = id;
    document.getElementById('editRoomNo').value = no;
    document.getElementById('editRoomType').value = type;
    document.getElementById('editRoomPrice').value = price;
    document.getElementById('editRoomStatus').value = status;
    document.getElementById('editModal').classList.add('visible');
}
function closeEditModal() {
    editingRoomId = null;
    document.getElementById('editModal').classList.remove('visible');
}

async function updateRoom(e) {
    e.preventDefault();
    if (!editingRoomId) return;
    const btn = document.getElementById('editSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Saving...';

    try {
        const res = await fetch(`${API}/api/rooms/${editingRoomId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                room_no: document.getElementById('editRoomNo').value.trim(),
                type: document.getElementById('editRoomType').value,
                price: parseFloat(document.getElementById('editRoomPrice').value),
                status: document.getElementById('editRoomStatus').value
            })
        });
        const data = await res.json();
        if (res.ok) { showToast(data.message, 'success'); closeEditModal(); loadRooms(); }
        else showToast(data.error, 'error');
    } catch (err) { showToast('Update failed', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '💾 Save Changes'; }
}

// ═══════════════════════════════════════════════════════════════════
// BOOKINGS
// ═══════════════════════════════════════════════════════════════════

async function loadBookings() {
    try {
        const [bRes, rRes] = await Promise.all([
            fetch(`${API}/api/bookings`),
            fetch(`${API}/api/rooms?status=available`)
        ]);
        if (bRes.status === 401) return logout();
        const bookings = await bRes.json();
        const rooms = await rRes.json();
        renderBookingsTable(bookings);
        populateRoomDropdown(rooms);
    } catch (err) { showToast('Failed to load bookings', 'error'); }
}

function populateRoomDropdown(rooms) {
    const sel = document.getElementById('bookRoomNo');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select a room...</option>';
    rooms.forEach(r => {
        sel.innerHTML += `<option value="${esc(r.room_no)}">Room ${esc(r.room_no)} — ${esc(r.type)} (₹${Number(r.price).toLocaleString()})</option>`;
    });
}

function renderBookingsTable(bookings) {
    const tbody = document.getElementById('bookingsTableBody');
    if (!bookings || bookings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📋</div><p>No active bookings</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = bookings.map(b => `
        <tr>
            <td class="text-bold">${esc(b.customer_name)}</td>
            <td>${esc(b.phone)}</td>
            <td><span style="font-weight:600;">🚪 ${esc(b.room_no)}</span></td>
            <td>${esc(b.check_in)}</td>
            <td>${esc(b.check_out)}</td>
            <td>${b.id_proof ? `<a href="/uploads/${esc(b.id_proof)}" target="_blank" class="id-proof-link">📎 View</a>` : '<span style="color:var(--text-muted)">—</span>'}</td>
            <td style="font-size:0.78rem;color:var(--text-muted)">${esc(b.booked_at || '')}</td>
            <td>
                <button class="btn btn-success btn-sm" onclick="checkoutBooking('${b._id}','${esc(b.room_no)}')">
                    🔓 Check Out
                </button>
            </td>
        </tr>
    `).join('');
}

async function createBooking(e) {
    e.preventDefault();
    const btn = document.getElementById('bookBtn');
    const form = document.getElementById('bookingForm');

    const name = document.getElementById('customerName').value.trim();
    const phone = document.getElementById('customerPhone').value.trim();
    const room = document.getElementById('bookRoomNo').value;
    const cin = document.getElementById('checkIn').value;
    const cout = document.getElementById('checkOut').value;

    if (!name || !phone || !room || !cin || !cout) { showToast('All fields are required', 'error'); return; }
    if (phone.length < 10) { showToast('Enter a valid phone number', 'error'); return; }
    if (new Date(cout) <= new Date(cin)) { showToast('Check-out must be after check-in', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Booking...';

    // Use FormData for file upload
    const fd = new FormData();
    fd.append('customer_name', name);
    fd.append('phone', phone);
    fd.append('room_no', room);
    fd.append('check_in', cin);
    fd.append('check_out', cout);

    const fileInput = document.getElementById('idProof');
    if (fileInput && fileInput.files[0]) {
        fd.append('id_proof', fileInput.files[0]);
    }

    try {
        const res = await fetch(`${API}/api/book`, { method: 'POST', body: fd });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, 'success');
            form.reset();
            loadBookings();
        } else {
            showToast(data.error, 'error');
        }
    } catch (err) { showToast('Booking failed', 'error'); }
    finally {
        btn.disabled = false;
        btn.innerHTML = '✅ Confirm Booking';
    }
}

async function checkoutBooking(id, roomNo) {
    if (!confirm(`Check out Room ${roomNo}?`)) return;
    showLoading();
    try {
        const res = await fetch(`${API}/api/bookings/${id}/checkout`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, 'success');
            loadBookings();
        } else showToast(data.error, 'error');
    } catch (err) { showToast('Checkout failed', 'error'); }
    finally { hideLoading(); }
}

// ═══════════════════════════════════════════════════════════════════
// BOOKING HISTORY
// ═══════════════════════════════════════════════════════════════════

async function loadHistory() {
    try {
        const res = await fetch(`${API}/api/history`);
        if (res.status === 401) return logout();
        const history = await res.json();
        renderHistoryTable(history);
    } catch (err) { showToast('Failed to load history', 'error'); }
}

function renderHistoryTable(history) {
    const tbody = document.getElementById('historyTableBody');
    if (!history || history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📜</div><p>No booking history yet</p></div></td></tr>`;
        return;
    }

    tbody.innerHTML = history.map(h => `
        <tr>
            <td class="text-bold">${esc(h.customer_name)}</td>
            <td>${esc(h.phone)}</td>
            <td>🚪 ${esc(h.room_no)}</td>
            <td><span class="badge badge-${typeBadge(h.room_type)}">${esc(h.room_type || 'N/A')}</span></td>
            <td class="text-price">₹${Number(h.price || 0).toLocaleString()}</td>
            <td>${esc(h.check_in)} → ${esc(h.check_out)}</td>
            <td style="font-size:0.78rem;color:var(--text-muted)">${esc(h.checked_out_at || '')}</td>
            <td><button class="receipt-btn" onclick='downloadReceipt(${JSON.stringify(h)})'>📄 Receipt</button></td>
        </tr>
    `).join('');
}

// ═══════════════════════════════════════════════════════════════════
// PDF RECEIPT DOWNLOAD (using jsPDF)
// ═══════════════════════════════════════════════════════════════════

function downloadReceipt(booking) {
    // Use jsPDF library loaded from CDN
    if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
        showToast('PDF library loading, please wait...', 'info');
        return;
    }

    const { jsPDF } = jspdf;
    const doc = new jsPDF();

    // Header
    doc.setFillColor(99, 102, 241);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('HotelHub', 105, 18, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Booking Receipt', 105, 30, { align: 'center' });

    // Body
    doc.setTextColor(30, 30, 30);
    let y = 55;
    const left = 25;
    const right = 95;

    function addRow(label, value) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(label, left, y);
        doc.setFont('helvetica', 'normal');
        doc.text(String(value || 'N/A'), right, y);
        y += 10;
    }

    addRow('Guest Name:', booking.customer_name);
    addRow('Phone:', booking.phone);
    addRow('Room No:', booking.room_no);
    addRow('Room Type:', booking.room_type || 'N/A');
    addRow('Price:', `Rs. ${Number(booking.price || 0).toLocaleString()}`);
    addRow('Check-In:', booking.check_in);
    addRow('Check-Out:', booking.check_out);
    addRow('Booked At:', booking.booked_at || 'N/A');
    addRow('Checked Out:', booking.checked_out_at || 'N/A');

    // Divider
    y += 5;
    doc.setDrawColor(99, 102, 241);
    doc.setLineWidth(0.5);
    doc.line(left, y, 185, y);
    y += 12;

    // Calculate nights
    const nights = Math.ceil(
        (new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24)
    );
    const total = nights * (booking.price || 0);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Total (${nights} night${nights > 1 ? 's' : ''}):`, left, y);
    doc.text(`Rs. ${total.toLocaleString()}`, right, y);

    // Footer
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(130, 130, 130);
    doc.text('Thank you for staying with us! — HotelHub Management System', 105, 280, { align: 'center' });

    doc.save(`receipt_room_${booking.room_no}_${booking.customer_name.replace(/\s+/g, '_')}.pdf`);
    showToast('Receipt downloaded!', 'success');
}

// ═══════════════════════════════════════════════════════════════════
// ANALYTICS (Chart.js)
// ═══════════════════════════════════════════════════════════════════

let charts = {};

async function loadAnalytics() {
    try {
        const res = await fetch(`${API}/api/analytics`);
        if (res.status === 401) return logout();
        if (res.status === 403) { showToast('Admin access required', 'error'); return; }
        const data = await res.json();
        renderCharts(data);
    } catch (err) { showToast('Failed to load analytics', 'error'); }
}

function renderCharts(data) {
    // Destroy old charts
    Object.values(charts).forEach(c => c.destroy());
    charts = {};

    const isDark = !document.body.classList.contains('light-mode');
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    Chart.defaults.color = textColor;

    // 1) Room Type Distribution (Doughnut)
    const typeCtx = document.getElementById('chartRoomTypes')?.getContext('2d');
    if (typeCtx && data.room_types) {
        charts.types = new Chart(typeCtx, {
            type: 'doughnut',
            data: {
                labels: data.room_types.map(t => t._id || 'Other'),
                datasets: [{
                    data: data.room_types.map(t => t.count),
                    backgroundColor: ['#6366f1', '#06b6d4', '#8b5cf6', '#f59e0b', '#10b981'],
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } }
                }
            }
        });
    }

    // 2) Room Status (Doughnut)
    const statusCtx = document.getElementById('chartRoomStatus')?.getContext('2d');
    if (statusCtx && data.room_status) {
        const statusColors = { available: '#10b981', booked: '#f59e0b', maintenance: '#f43f5e' };
        charts.status = new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: data.room_status.map(s => s._id || 'Other'),
                datasets: [{
                    data: data.room_status.map(s => s.count),
                    backgroundColor: data.room_status.map(s => statusColors[s._id] || '#6366f1'),
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } }
                }
            }
        });
    }

    // 3) Revenue by type (Bar)
    const revCtx = document.getElementById('chartRevenue')?.getContext('2d');
    if (revCtx && data.revenue_by_type) {
        charts.revenue = new Chart(revCtx, {
            type: 'bar',
            data: {
                labels: data.revenue_by_type.map(r => r._id || 'Other'),
                datasets: [{
                    label: 'Revenue (₹)',
                    data: data.revenue_by_type.map(r => r.revenue),
                    backgroundColor: ['rgba(99,102,241,0.7)', 'rgba(6,182,212,0.7)', 'rgba(139,92,246,0.7)'],
                    borderRadius: 8,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: gridColor }, beginAtZero: true },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // 4) Monthly bookings (Line)
    const monthCtx = document.getElementById('chartMonthly')?.getContext('2d');
    if (monthCtx && data.monthly_bookings) {
        charts.monthly = new Chart(monthCtx, {
            type: 'line',
            data: {
                labels: data.monthly_bookings.map(m => m._id),
                datasets: [{
                    label: 'Bookings',
                    data: data.monthly_bookings.map(m => m.count),
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99,102,241,0.1)',
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#6366f1',
                    pointRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: gridColor }, beginAtZero: true },
                    x: { grid: { display: false } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// SEED DATA
// ═══════════════════════════════════════════════════════════════════

async function seedData() {
    if (!confirm('Clear all data and load samples? (Login: admin/1234, user/1234)')) return;
    showLoading();
    try {
        const res = await fetch(`${API}/api/seed`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) { showToast(data.message, 'success'); navigateTo(currentPage); }
        else showToast('Seed failed', 'error');
    } catch (err) { showToast('Server error', 'error'); }
    finally { hideLoading(); }
}

// ═══════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════

async function logout() {
    try { await fetch(`${API}/api/logout`, { method: 'POST' }); }
    catch (e) {}
    window.location.href = '/login';
}

// ═══════════════════════════════════════════════════════════════════
// DARK/LIGHT THEME TOGGLE
// ═══════════════════════════════════════════════════════════════════

function toggleTheme() {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('hotelhub-theme', isLight ? 'light' : 'dark');
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = isLight ? '🌙 Dark Mode' : '☀️ Light Mode';

    // Re-render charts with new colors
    if (currentPage === 'analytics') loadAnalytics();
}

function applyStoredTheme() {
    const stored = localStorage.getItem('hotelhub-theme');
    if (stored === 'light') {
        document.body.classList.add('light-mode');
        const btn = document.getElementById('themeBtn');
        if (btn) btn.textContent = '🌙 Dark Mode';
    }
}

// ═══════════════════════════════════════════════════════════════════
// MOBILE
// ═══════════════════════════════════════════════════════════════════

function toggleSidebar() {
    document.querySelector('.sidebar')?.classList.toggle('open');
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function typeBadge(type) {
    if (!type) return 'ac';
    const t = type.toLowerCase();
    if (t.includes('deluxe')) return 'deluxe';
    if (t.includes('non')) return 'non-ac';
    return 'ac';
}

function statusIcon(s) {
    if (s === 'available') return '🟢';
    if (s === 'booked') return '🟡';
    if (s === 'maintenance') return '🔴';
    return '⚪';
}

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    applyStoredTheme();

    // Set role from template-rendered data attribute
    const roleEl = document.getElementById('appRoot');
    if (roleEl) {
        userRole = roleEl.dataset.role || 'user';
    }

    // Set min dates
    const today = new Date().toISOString().split('T')[0];
    const checkInEl = document.getElementById('checkIn');
    const checkOutEl = document.getElementById('checkOut');
    if (checkInEl) checkInEl.setAttribute('min', today);
    if (checkOutEl) checkOutEl.setAttribute('min', today);

    // Load dashboard
    loadDashboard();
});
