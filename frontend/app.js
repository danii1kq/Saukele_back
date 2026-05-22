// Use the local backend directly in dev, and the reverse proxy path in Docker/nginx.
const isLocalDevHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = isLocalDevHost ? 'http://localhost:4000/api' : '/api';
let accessToken = localStorage.getItem('accessToken');
let refreshToken = localStorage.getItem('refreshToken');
const CURRENT_USER_KEY = 'currentUser';
let currentProfile = readCurrentProfile();

function readCurrentProfile() {
    try {
        const raw = localStorage.getItem(CURRENT_USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function saveCurrentProfile(profile) {
    currentProfile = profile || null;
    if (profile) {
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(profile));
    } else {
        localStorage.removeItem(CURRENT_USER_KEY);
    }
}

function decodeTokenPayload(token) {
    try {
        return JSON.parse(atob(token.split('.')[1]));
    } catch (error) {
        return null;
    }
}

function getCurrentRole() {
    return currentProfile?.role || decodeTokenPayload(accessToken || '')?.role || null;
}

function canAccessProtectedUI() {
    return Boolean(accessToken);
}

function canUseRegistrantUI() {
    const role = getCurrentRole();
    return role === 'REGISTRANT' || role === 'ADMIN';
}

function canUseAdminUI() {
    return getCurrentRole() === 'ADMIN';
}

function canShowProfileActions() {
    return canAccessProtectedUI();
}

function showNotification(message, type = 'success') {
    const notif = document.getElementById('notification');
    if (!notif) {
        alert(message);
        return;
    }
    notif.textContent = message;
    const alertType = type === 'error' ? 'danger' : type;
    notif.className = `alert alert-${alertType} mb-3`;
    notif.classList.remove('d-none');
    setTimeout(() => {
        notif.classList.add('d-none');
    }, 5000);
}

function updateUI() {
    const linkLogin = document.getElementById('linkLogin');
    const linkRegister = document.getElementById('linkRegister');
    const linkDashboard = document.getElementById('linkDashboard');
    const linkProfile = document.getElementById('linkProfile');
    const linkRegistrant = document.getElementById('linkRegistrant');
    const linkAdmin = document.getElementById('linkAdmin');
    const btnLogout = document.getElementById('btnLogout');
    const currentUser = document.getElementById('currentUser');
    const roleBadge = document.getElementById('roleBadge');

    const setVisible = (element, visible, displayStyle = 'inline-block') => {
        if (!element) return;
        element.classList.toggle('d-none', !visible);
        element.style.display = visible ? displayStyle : '';
    };

    if (accessToken) {
        // Logged in
        setVisible(linkLogin, false);
        setVisible(linkRegister, false);
        setVisible(linkDashboard, true);
        setVisible(linkProfile, true);
        setVisible(linkRegistrant, canUseRegistrantUI());
        setVisible(linkAdmin, canUseAdminUI());
        setVisible(btnLogout, true);
        
        if (currentUser) {
            currentUser.textContent = currentProfile?.email || decodeTokenPayload(accessToken)?.sub || 'User';
        }
        if (roleBadge) {
            roleBadge.textContent = getCurrentRole() || 'GUEST';
        }
    } else {
        // Not logged in
        setVisible(linkLogin, true);
        setVisible(linkRegister, true);
        setVisible(linkDashboard, true);
        setVisible(linkProfile, false);
        setVisible(linkRegistrant, false);
        setVisible(linkAdmin, false);
        if(currentUser) currentUser.textContent = '';
        if (roleBadge) roleBadge.textContent = 'GUEST';
    }
}

document.addEventListener('DOMContentLoaded', bootstrapApp);

async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    try {
        let res = await fetch(`${API_URL}${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null
        });

        if (res.status === 401 && refreshToken) {
            // Try refresh
            const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (refreshRes.ok) {
                const data = await refreshRes.json();
                accessToken = data.accessToken;
                localStorage.setItem('accessToken', accessToken);
                headers['Authorization'] = `Bearer ${accessToken}`;
                res = await fetch(`${API_URL}${endpoint}`, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : null
                });
            } else {
                logout(false);
                throw new Error('Session expired. Please log in again.');
            }
        }

        let data = {};
        try {
            data = await res.json();
        } catch(e) { }
        
        if (!res.ok) {
            throw new Error(data.error || data.message || `Error ${res.status}`);
        }
        return data;
    } catch (error) {
        showNotification(error.message, 'error');
        throw error;
    }
}

async function publicApiCall(endpoint) {
    const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });

    let data = {};
    try {
        data = await res.json();
    } catch (error) { }

    if (!res.ok) {
        throw new Error(data.error || data.message || `Error ${res.status}`);
    }

    return data;
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        const data = await apiCall('/auth/login', 'POST', { email, password });
        if (data.accessToken) {
            accessToken = data.accessToken;
            refreshToken = data.refreshToken;
            saveCurrentProfile(data.user || null);
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
            showNotification('Login successful!', 'success');
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
        }
    } catch (e) { }
}

async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const name = document.getElementById('name').value;
    try {
        const data = await apiCall('/auth/register', 'POST', { email, password, name });
        saveCurrentProfile(data.user || { email, name, role: 'GUEST' });
        showNotification('Registration successful!', 'success');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
    } catch (e) {}
}

async function handleResendVerification() {
    const email = document.getElementById('profileEmail')?.value || document.getElementById('email')?.value || currentProfile?.email;
    if (!email) return showNotification('Please enter your email first.', 'error');
    try {
        await apiCall('/auth/resend-verification', 'POST', { email });
        showNotification('Verification email resent.', 'success');
    } catch (e) {}
}

async function handleForgotPassword() {
    const email = document.getElementById('profileEmail')?.value || document.getElementById('email')?.value || currentProfile?.email;
    if (!email) return showNotification('Please enter your email first.', 'error');
    try {
        await apiCall('/auth/forgot-password', 'POST', { email });
        showNotification('If the email exists, a reset link will be sent.', 'success');
    } catch (e) {}
}

async function logout(callApi = true) {
    if (callApi && refreshToken) {
        try { await apiCall('/auth/logout', 'POST', { refreshToken }); } catch(e){}
    }
    accessToken = null;
    refreshToken = null;
    saveCurrentProfile(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    window.location.href = 'login.html';
}

async function initDashboard() {
    if (!accessToken) return window.location.href = 'login.html';
    loadRegistries();
    loadFamily();
}

async function loadRegistries() {
    const list = document.getElementById('registriesList');
    if (!list) return;
    list.innerHTML = '<div class="alert alert-info mb-0">Loading...</div>';
    try {
        const res = await apiCall('/registries');
        const data = res.data || res;
        list.innerHTML = data.length === 0 ? '<div class="alert alert-secondary mb-0">No registries found.</div>' : data.map(r => `
            <div class="list-group-item">
                <strong>ID: ${r.id} | ${escapeHtml(r.title)}</strong>
                <div class="text-secondary small">Couple: ${escapeHtml(r.coupleName)}</div>
                <div class="text-secondary small">Date: ${new Date(r.weddingDate).toLocaleDateString()}</div>
                <div class="text-secondary small">Status: ${escapeHtml(r.status)}</div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="alert alert-danger mb-0">Failed to load registries.</div>';
    }
}

async function handleCreateRegistry(e) {
    e.preventDefault();
    const title = document.getElementById('regTitle').value;
    const coupleName = document.getElementById('regCouple').value;
    const weddingDate = document.getElementById('regDate').value;
    const isPublic = document.getElementById('regPublic').value === 'true';
    
    try {
        await apiCall('/registries', 'POST', { title, coupleName, weddingDate, isPublic });
        showNotification('Registry created!', 'success');
        loadRegistries();
    } catch (e) {}
}

async function loadFamily() {
    const list = document.getElementById('familyList');
    if (!list) return;
    list.innerHTML = '<div class="alert alert-info mb-0">Loading...</div>';
    try {
        const res = await apiCall('/family-members');
        const data = res.data || res;
        list.innerHTML = (!data || data.length === 0) ? '<div class="alert alert-secondary mb-0">No family members found.</div>' : data.map(f => `
            <div class="list-group-item">
                <strong>${escapeHtml(f.name)}</strong>
                <div class="text-secondary small">${escapeHtml(f.kinshipTier)}</div>
                <div class="text-secondary small">Relationship: ${escapeHtml(f.relationshipType)}</div>
                <div class="text-secondary small">Related user: ${f.relatedUserId || 'N/A'}</div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="alert alert-danger mb-0">Failed to load family members.</div>';
    }
}

async function handleAddFamily(e) {
    e.preventDefault();
    const name = document.getElementById('famName').value;
    const relationshipType = document.getElementById('famRelation').value;
    const kinshipTier = document.getElementById('famTier').value;
    try {
        await apiCall('/family-members', 'POST', { name, relationshipType, kinshipTier });
        showNotification('Family member added!', 'success');
        loadFamily();
    } catch (e) {}
}

async function loadGiftsForRegistry() {
    const regId = document.getElementById('giftRegId').value;
    const list = document.getElementById('giftsList');
    if (!regId) return showNotification('Enter Registry ID first.', 'error');
    list.innerHTML = '<div class="alert alert-info mb-0">Loading...</div>';
    try {
        const res = await apiCall(`/registries/${regId}/items`);
        const gifts = res.data || res;
        list.innerHTML = (!gifts || gifts.length === 0) ? '<div class="alert alert-secondary mb-0">No gifts in this registry.</div>' : gifts.map(g => `
            <div class="list-group-item">
                <strong>ID: ${g.id} | ${escapeHtml(g.title)}</strong>
                <div class="text-secondary small">Target: ${g.targetAmountKzt} KZT</div>
                <div class="text-secondary small">Current: ${g.currentAmountKzt || 0} KZT</div>
                <div class="text-secondary small">Status: ${escapeHtml(g.status)} | priority: ${escapeHtml(g.priority || 'N/A')}</div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="alert alert-danger mb-0">Failed to load gifts.</div>';
    }
}

async function handleAddGift(e) {
    e.preventDefault();
    const regId = document.getElementById('giftRegId').value;
    if (!regId) return showNotification('Enter Registry ID above first.', 'error');
    
    const title = document.getElementById('giftTitle').value;
    const description = document.getElementById('giftDesc').value || undefined;
    const targetAmountKzt = document.getElementById('giftPriceKzt').value;
    
    try {
        await apiCall(`/registries/${regId}/items`, 'POST', { 
            title, 
            description, 
            targetAmountKzt
        });
        showNotification('Gift added successfully!', 'success');
        loadGiftsForRegistry();
    } catch (e) {}
}

async function handleContribute(e) {
    e.preventDefault();
    const giftItemId = parseInt(document.getElementById('contribGiftId').value);
    const amount = parseFloat(document.getElementById('contribAmount').value);
    const currency = document.getElementById('contribCurrency').value;
    const contributorName = document.getElementById('contribName').value;
    
    try {
        await apiCall(`/items/${giftItemId}/contributions`, 'POST', { 
            contributorName,
            amountKzt: currency === 'KZT' ? amount : undefined,
            amountEur: currency === 'EUR' ? amount : undefined,
            message: 'From web UI'
        });
        showNotification('Contribution successful!', 'success');
        const regId = document.getElementById('giftRegId').value;
        if(regId) loadGiftsForRegistry();
    } catch (e) {}
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getNextGiftStatus(status) {
    if (status === 'PENDING') return 'FUNDED';
    if (status === 'FUNDED') return 'PURCHASED';
    if (status === 'PURCHASED') return 'DELIVERED';
    return null;
}

async function bootstrapApp() {
    updateUI();
    await syncCurrentProfile();
    updateUI();
    await initIndexPage();
    await initDashboardPage();
}

async function syncCurrentProfile() {
    if (!accessToken) {
        return;
    }

    try {
        const profile = await apiCall('/auth/me');
        saveCurrentProfile(profile);
    } catch (error) {
        if (!currentProfile) {
            const payload = decodeTokenPayload(accessToken);
            if (payload) {
                saveCurrentProfile({
                    id: Number(payload.sub),
                    role: payload.role || 'GUEST',
                });
            }
        }
    }
}

async function initIndexPage() {
    const publicList = document.getElementById('publicRegistriesList');
    if (publicList) {
        await loadPublicRegistries();
    }

    const accountSummary = document.getElementById('accountSummary');
    if (accountSummary) {
        renderAccountSummary();
    }

    const registryHash = window.location.hash.replace('#registry=', '');
    if (registryHash && document.getElementById('registryDetailPanel')) {
        await openPublicRegistry(registryHash);
    }
}

async function initDashboardPage() {
    if (!document.getElementById('dashboardWorkspace')) {
        return;
    }

    if (!accessToken) {
        window.location.href = 'login.html';
        return;
    }

    await loadProfileSection();
    await loadFamily();
    await loadMyContributions();
    await loadMyRegistries();
    await loadAdminConsole();
    renderRoleVisibility();
}

function renderAccountSummary() {
    const accountSummary = document.getElementById('accountSummary');
    if (!accountSummary) {
        return;
    }

    if (!accessToken) {
        accountSummary.innerHTML = `
            <div class="card-body">
                <h3 class="h5 mb-2">Your account</h3>
                <p class="text-secondary mb-3">Log in to manage your profile, family members, and registries.</p>
                <div class="alert alert-secondary mb-0">Public browsing is available without authentication.</div>
            </div>
        `;
        return;
    }

    accountSummary.innerHTML = `
        <div class="card-body">
            <h3 class="h5 mb-2">Your account</h3>
            <p class="text-secondary mb-3">${escapeHtml(currentProfile?.email || 'Authenticated user')} · ${escapeHtml(getCurrentRole() || 'GUEST')}</p>
            <div class="alert alert-light border mb-0">
                Use the dashboard to update your profile, manage family members, and access role-specific tools.
            </div>
        </div>
    `;
}

function renderRoleVisibility() {
    const registrantBlocks = document.querySelectorAll('[data-role="registrant"]');
    const adminBlocks = document.querySelectorAll('[data-role="admin"]');
    const hasRegistrant = canUseRegistrantUI();
    const hasAdmin = canUseAdminUI();

    registrantBlocks.forEach((block) => {
        block.hidden = !hasRegistrant;
        block.classList.toggle('is-visible', hasRegistrant);
    });

    adminBlocks.forEach((block) => {
        block.hidden = !hasAdmin;
        block.classList.toggle('is-visible', hasAdmin);
    });

    const linkRegistrant = document.getElementById('linkRegistrant');
    const linkAdmin = document.getElementById('linkAdmin');
    if (linkRegistrant) {
        linkRegistrant.hidden = !hasRegistrant;
    }
    if (linkAdmin) {
        linkAdmin.hidden = !hasAdmin;
    }
}

async function loadPublicRegistries() {
    const list = document.getElementById('publicRegistriesList');
    if (!list) {
        return;
    }

    list.innerHTML = '<div class="col-12"><div class="alert alert-info mb-0">Loading public registries...</div></div>';

    try {
        const response = await publicApiCall('/registries?take=24&sort=-createdAt');
        const registries = response.data || response || [];
        window.publicRegistriesCache = Array.isArray(registries) ? registries : [];

        if (!registries.length) {
            list.innerHTML = '<div class="col-12"><div class="alert alert-secondary mb-0">No public registries yet.</div></div>';
            return;
        }

        list.innerHTML = registries.map((registry) => `
            <div class="col-md-6 col-xl-4">
                <button class="card border-0 shadow-sm text-start w-100 h-100" type="button" onclick="openPublicRegistry('${registry.shareCode}')">
                    <div class="card-body d-grid gap-2">
                        <div class="d-flex justify-content-between align-items-start gap-2">
                            <strong class="fs-6">${escapeHtml(registry.title)}</strong>
                            <span class="badge ${registry.isPublic ? 'text-bg-success' : 'text-bg-secondary'}">${registry.isPublic ? 'Public' : 'Private'}</span>
                        </div>
                        <div class="text-secondary">${escapeHtml(registry.coupleName)}</div>
                        <div class="text-secondary small">${new Date(registry.weddingDate).toLocaleDateString()}</div>
                        <div><span class="badge text-bg-light border text-dark">${escapeHtml(registry.shareCode)}</span></div>
                    </div>
                </button>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = '<div class="col-12"><div class="alert alert-danger mb-0">Failed to load registries.</div></div>';
    }
}

async function openPublicRegistry(shareCode) {
    const panel = document.getElementById('registryDetailPanel');
    if (!panel) {
        return;
    }

    const normalizedShareCode = String(shareCode || '').trim();
    const cachedRegistry = (window.publicRegistriesCache || []).find((registry) => registry.shareCode === normalizedShareCode) || null;
    panel.innerHTML = '<div class="alert alert-info mb-0">Loading registry details...</div>';
    window.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}#registry=${encodeURIComponent(normalizedShareCode)}`);

    try {
        const registry = await publicApiCall(`/registries/share/${normalizedShareCode}`);
        panel.innerHTML = renderRegistryDetail(registry, true);
        if (canSeeRegistryContributions(registry)) {
            await loadVisibleContributions(registry);
        }
    } catch (error) {
        if (cachedRegistry) {
            panel.innerHTML = `
                <div class="alert alert-warning mb-3">Registry details are temporarily unavailable. Showing cached summary.</div>
                ${renderRegistryDetail({ ...cachedRegistry, giftItems: [] }, false)}
            `;
            return;
        }

        panel.innerHTML = '<div class="alert alert-danger mb-0">Registry not found.</div>';
    }
}

function canSeeRegistryContributions(registry) {
    const role = getCurrentRole();
    return role === 'ADMIN' || (currentProfile && Number(currentProfile.id) === Number(registry.userId));
}

function renderRegistryDetail(registry, allowContributionForm) {
    const canViewContributions = canSeeRegistryContributions(registry);
    const gifts = Array.isArray(registry.giftItems) ? registry.giftItems : [];

    return `
        <div class="mb-3">
            <h3 class="h4 mb-1">${escapeHtml(registry.title)}</h3>
            <p class="text-secondary mb-0">${escapeHtml(registry.coupleName)} · ${new Date(registry.weddingDate).toLocaleDateString()}</p>
        </div>
        <div class="d-flex flex-wrap gap-2 mb-3">
            <span class="badge text-bg-light border text-dark">Share code: ${escapeHtml(registry.shareCode)}</span>
            <span class="badge text-bg-light border text-dark">Status: ${escapeHtml(registry.status)}</span>
            <span class="badge ${registry.isPublic ? 'text-bg-success' : 'text-bg-secondary'}">${registry.isPublic ? 'Public' : 'Private'}</span>
        </div>
        <div class="row g-3">
            ${gifts.length ? gifts.map((gift) => renderGiftCard(registry, gift, allowContributionForm, canViewContributions)).join('') : '<div class="col-12"><div class="alert alert-secondary mb-0">No gifts in this registry yet.</div></div>'}
        </div>
    `;
}

function renderGiftCard(registry, gift, allowContributionForm, canViewContributions) {
    const giftPanelId = `gift-contributions-${gift.id}`;
    return `
        <div class="col-12">
            <article class="card border-0 shadow-sm h-100">
                <div class="card-body d-grid gap-3">
                    <div>
                        <h4 class="h5 mb-1">${escapeHtml(gift.title)}</h4>
                        <p class="text-secondary mb-0">${escapeHtml(gift.priority || 'MEDIUM')} · ${escapeHtml(gift.status)}</p>
                    </div>
                    <p class="mb-0">${escapeHtml(gift.description || 'No description')}</p>
                    <div class="d-flex flex-wrap gap-2">
                        <span class="badge text-bg-light border text-dark">Target: ${gift.targetAmountKzt} KZT</span>
                        <span class="badge text-bg-light border text-dark">Raised: ${gift.currentAmountKzt || 0} KZT</span>
                        ${gift.targetAmountEur ? `<span class="badge text-bg-light border text-dark">${gift.targetAmountEur} EUR</span>` : ''}
                    </div>
            ${allowContributionForm ? `
                <form class="row g-2 align-items-end" onsubmit="handlePublicContribution(event, ${gift.id})">
                    <div class="col-md-4"><input id="publicContributorName-${gift.id}" type="text" class="form-control" placeholder="Your name" required></div>
                    <div class="col-md-3"><input id="publicContributionAmount-${gift.id}" type="number" min="1000" step="0.01" class="form-control" placeholder="Amount in KZT" required></div>
                    <div class="col-md-3"><input id="publicContributionMessage-${gift.id}" type="text" class="form-control" placeholder="Message"></div>
                    <div class="col-md-2 d-grid"><button class="btn btn-primary" type="submit">Contribute</button></div>
                </form>
            ` : ''}
            ${canViewContributions ? `
                <div class="d-flex gap-2">
                    <button class="btn btn-outline-secondary btn-sm" type="button" onclick="loadGiftContributions(${gift.id}, '${giftPanelId}')">Load contributions</button>
                </div>
                <div id="${giftPanelId}" class="alert alert-light border mb-0">Contributions hidden until loaded.</div>
            ` : '<div class="alert alert-light border mb-0">Contributions are visible to the registry owner or admins only.</div>'}
                </div>
            </article>
        </div>
    `;
}

async function handlePublicContribution(event, itemId) {
    event.preventDefault();
    const name = document.getElementById(`publicContributorName-${itemId}`)?.value;
    const amount = Number(document.getElementById(`publicContributionAmount-${itemId}`)?.value);
    const message = document.getElementById(`publicContributionMessage-${itemId}`)?.value || '';

    try {
        await apiCall(`/items/${itemId}/contributions`, 'POST', {
            contributorName: name,
            amountKzt: amount,
            message,
        });
        showNotification('Contribution sent successfully!', 'success');
        const registryHash = window.location.hash.replace('#registry=', '');
        if (registryHash) {
            await openPublicRegistry(registryHash);
        }
    } catch (error) {}
}

async function loadGiftContributions(itemId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        return;
    }

    container.innerHTML = '<div class="alert alert-info mb-0">Loading contributions...</div>';

    try {
        const response = await apiCall(`/items/${itemId}/contributions`);
        const contributions = response.data || response || [];
        if (!contributions.length) {
            container.innerHTML = '<div class="alert alert-secondary mb-0">No contributions yet.</div>';
            return;
        }

        container.innerHTML = `<div class="list-group">${contributions.map((contribution) => `
            <div class="list-group-item d-flex justify-content-between align-items-center gap-3">
                <div>
                    <strong>${escapeHtml(contribution.contributorName)}</strong>
                    <div class="text-secondary small">${escapeHtml(contribution.status)}</div>
                </div>
                <span class="badge text-bg-light border text-dark">${contribution.amountKzt} KZT</span>
            </div>
        `).join('')}</div>`;
    } catch (error) {
        container.innerHTML = '<div class="alert alert-danger mb-0">Failed to load contributions.</div>';
    }
}

async function loadProfileSection() {
    const profileSummary = document.getElementById('profileSummary');
    const resendVerificationBlock = document.getElementById('resendVerificationBlock');
    if (!profileSummary) {
        return;
    }

    const setResendVerificationVisible = (visible) => {
        if (!resendVerificationBlock) return;
        resendVerificationBlock.classList.toggle('d-none', !visible);
    };

    profileSummary.innerHTML = '<div class="alert alert-info mb-0">Loading profile...</div>';

    try {
        const profile = await apiCall('/auth/me');
        saveCurrentProfile(profile);
        setResendVerificationVisible(!profile.isVerified);
        profileSummary.innerHTML = `
            <div class="list-group">
                <div class="list-group-item d-flex justify-content-between align-items-center"><strong>${escapeHtml(profile.name)}</strong><span class="badge text-bg-secondary">${escapeHtml(profile.role)}</span></div>
                <div class="list-group-item d-flex justify-content-between align-items-center"><span>Email</span><span>${escapeHtml(profile.email)}</span></div>
                <div class="list-group-item d-flex justify-content-between align-items-center"><span>Verified</span><span>${profile.isVerified ? 'Yes' : 'No'}</span></div>
            </div>
        `;
    } catch (error) {
        profileSummary.innerHTML = `
            <div class="list-group">
                <div class="list-group-item d-flex justify-content-between align-items-center"><strong>${escapeHtml(currentProfile?.name || 'User')}</strong><span class="badge text-bg-secondary">${escapeHtml(getCurrentRole() || 'GUEST')}</span></div>
                <div class="list-group-item d-flex justify-content-between align-items-center"><span>Email</span><span>${escapeHtml(currentProfile?.email || 'Unavailable until verification')}</span></div>
            </div>
        `;
        setResendVerificationVisible(!currentProfile?.isVerified);
    }
}

async function handleChangePassword(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('currentPassword')?.value;
    const newPassword = document.getElementById('newPassword')?.value;

    try {
        await apiCall('/auth/change-password', 'POST', { currentPassword, newPassword });
        showNotification('Password changed. You will be signed out.', 'success');
        setTimeout(() => logout(false), 900);
    } catch (error) {}
}

async function loadFamily() {
    const list = document.getElementById('familyList');
    if (!list) return;
    list.innerHTML = '<div class="alert alert-info mb-0">Loading...</div>';
    try {
        const res = await apiCall('/family-members');
        const data = res.data || res;
        list.innerHTML = (!data || data.length === 0) ? '<div class="alert alert-secondary mb-0">No family members found.</div>' : data.map(f => `
            <div class="list-group-item">
                <div class="d-flex justify-content-between align-items-start gap-3">
                    <div>
                        <strong>${escapeHtml(f.name)}</strong>
                        <div class="text-secondary small">${escapeHtml(f.kinshipTier)} · ${escapeHtml(f.relationshipType)}</div>
                        <div class="text-secondary small">Related user: ${f.relatedUserId || 'N/A'}</div>
                    </div>
                    <button type="button" class="btn btn-outline-secondary btn-sm" onclick="handleDeleteFamilyMember(${f.id})">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = '<div class="alert alert-danger mb-0">Failed to load family members.</div>';
    }
}

async function handleDeleteFamilyMember(id) {
    try {
        await apiCall(`/family-members/${id}`, 'DELETE');
        showNotification('Family member removed.', 'success');
        loadFamily();
    } catch (error) {}
}

async function loadMyContributions() {
    const list = document.getElementById('myContributionsList');
    if (!list) return;
    list.innerHTML = '<div class="alert alert-info mb-0">Loading...</div>';
    try {
        const response = await apiCall('/contributions/my');
        const contributions = response.data || response || [];
        list.innerHTML = contributions.length === 0 ? '<div class="alert alert-secondary mb-0">No contributions found.</div>' : contributions.map((contribution) => `
            <div class="list-group-item d-flex justify-content-between align-items-center gap-3">
                <div>
                    <strong>${escapeHtml(contribution.contributorName)}</strong>
                    <div class="text-secondary small">${escapeHtml(contribution.status)}</div>
                </div>
                <span class="badge text-bg-light border text-dark">${contribution.amountKzt} KZT</span>
            </div>
        `).join('');
    } catch (error) {
        list.innerHTML = '<div class="alert alert-danger mb-0">Failed to load contributions.</div>';
    }
}

async function loadMyRegistries() {
    const list = document.getElementById('myRegistriesList');
    const select = document.getElementById('managedRegistrySelect');
    if (!list && !select) return;

    if (list) list.innerHTML = '<div class="alert alert-info mb-0">Loading...</div>';
    try {
        const response = await apiCall('/registries/mine');
        const registries = response.data || response || [];

        if (select) {
            select.innerHTML = registries.length ? registries.map((registry) => `
                <option value="${registry.id}">${escapeHtml(registry.title)}</option>
            `).join('') : '<option value="">No registries</option>';
        }

        if (list) {
            list.innerHTML = registries.length === 0 ? '<div class="alert alert-secondary mb-0">No registries found.</div>' : registries.map((registry) => `
                <div class="list-group-item">
                    <div class="d-flex justify-content-between align-items-start gap-3">
                        <div>
                            <strong>${escapeHtml(registry.title)}</strong>
                            <div class="text-secondary small">Code: ${escapeHtml(registry.shareCode)}</div>
                            <div class="text-secondary small">Public: ${registry.isPublic ? 'Yes' : 'No'}</div>
                        </div>
                        <button class="btn btn-outline-secondary btn-sm" type="button" onclick="loadManagedRegistry(${registry.id})">Open</button>
                    </div>
                </div>
            `).join('');
        }

        if (registries[0]) {
            await loadManagedRegistry(registries[0].id);
        }
    } catch (error) {
        if (list) {
            list.innerHTML = '<div class="alert alert-danger mb-0">Failed to load registries.</div>';
        }
    }
}

async function handleCreateRegistry(e) {
    e.preventDefault();
    const title = document.getElementById('regTitle')?.value;
    const coupleName = document.getElementById('regCouple')?.value;
    const weddingDate = document.getElementById('regDate')?.value;
    const isPublic = document.getElementById('regPublic')?.value === 'true';
    
    try {
        const created = await apiCall('/registries', 'POST', { title, coupleName, weddingDate, isPublic });
        showNotification('Registry created!', 'success');
        await loadMyRegistries();
        if (created?.id) {
            await loadManagedRegistry(created.id);
        }
    } catch (e) {}
}

async function loadManagedRegistry(registryId) {
    if (!registryId) {
        const registryTitle = document.getElementById('managedRegistryTitle');
        const registryItemsList = document.getElementById('managedRegistryItems');
        if (registryTitle) {
            registryTitle.textContent = 'Select a registry';
        }
        if (registryItemsList) {
            registryItemsList.innerHTML = '<div class="alert alert-secondary mb-0">Choose a registry to see its gift items.</div>';
        }
        return;
    }

    const registryTitle = document.getElementById('managedRegistryTitle');
    const registryItemsList = document.getElementById('managedRegistryItems');
    const managedRegistrySelect = document.getElementById('managedRegistrySelect');

    if (registryTitle) {
        registryTitle.textContent = 'Loading registry...';
    }
    if (registryItemsList) {
        registryItemsList.innerHTML = '<div class="alert alert-info mb-0">Loading...</div>';
    }
    if (managedRegistrySelect) {
        managedRegistrySelect.value = String(registryId);
    }

    try {
        const registry = await apiCall(`/registries/${registryId}`);
        if (registryTitle) {
            registryTitle.textContent = `${registry.title} · ${registry.shareCode}`;
        }

        const response = await apiCall(`/registries/${registryId}/items`);
        const items = response.data || response || [];
        if (registryItemsList) {
            registryItemsList.innerHTML = items.length === 0 ? '<div class="alert alert-secondary mb-0">No gift items yet.</div>' : items.map((item) => `
                <div class="list-group-item">
                    <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
                        <div>
                            <strong>${escapeHtml(item.title)}</strong>
                            <div class="text-secondary small">Target: ${item.targetAmountKzt} KZT · Current: ${item.currentAmountKzt || 0} KZT</div>
                            <div class="text-secondary small">Status: ${escapeHtml(item.status)} · Priority: ${escapeHtml(item.priority)}</div>
                        </div>
                        <div class="btn-group btn-group-sm flex-wrap" role="group">
                            <button class="btn btn-outline-secondary" type="button" onclick='populateGiftEditor(${JSON.stringify(item).replaceAll("'", "&#39;")})'>Edit</button>
                            <button class="btn btn-outline-secondary" type="button" onclick="deleteGiftItem(${registryId}, ${item.id})">Delete</button>
                            <button class="btn btn-outline-secondary" type="button" onclick="advanceGiftItemStatus(${registryId}, ${item.id}, '${getNextGiftStatus(item.status) || ''}')">Advance</button>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        if (registryTitle) {
            registryTitle.textContent = 'Registry unavailable';
        }
        if (registryItemsList) {
            registryItemsList.innerHTML = '<div class="alert alert-danger mb-0">Failed to load registry.</div>';
        }
    }
}

function populateGiftEditor(item) {
    const registryId = document.getElementById('managedRegistrySelect')?.value;
    if (document.getElementById('managedGiftId')) document.getElementById('managedGiftId').value = item.id;
    if (document.getElementById('managedGiftTitle')) document.getElementById('managedGiftTitle').value = item.title || '';
    if (document.getElementById('managedGiftDesc')) document.getElementById('managedGiftDesc').value = item.description || '';
    if (document.getElementById('managedGiftImageUrl')) document.getElementById('managedGiftImageUrl').value = item.imageUrl || '';
    if (document.getElementById('managedGiftTargetKzt')) document.getElementById('managedGiftTargetKzt').value = item.targetAmountKzt || '';
    if (document.getElementById('managedGiftTargetEur')) document.getElementById('managedGiftTargetEur').value = item.targetAmountEur || '';
    if (document.getElementById('managedGiftPriority')) document.getElementById('managedGiftPriority').value = item.priority || 'MEDIUM';
    if (document.getElementById('managedGiftRegistryId')) document.getElementById('managedGiftRegistryId').value = registryId || '';
}

async function handleSaveManagedGift(event) {
    event.preventDefault();
    const registryId = Number(document.getElementById('managedGiftRegistryId')?.value || document.getElementById('managedRegistrySelect')?.value);
    const giftItemId = document.getElementById('managedGiftId')?.value;
    const payload = {
        title: document.getElementById('managedGiftTitle')?.value,
        description: document.getElementById('managedGiftDesc')?.value || undefined,
        imageUrl: document.getElementById('managedGiftImageUrl')?.value || undefined,
        targetAmountKzt: document.getElementById('managedGiftTargetKzt')?.value,
        targetAmountEur: document.getElementById('managedGiftTargetEur')?.value || undefined,
        priority: document.getElementById('managedGiftPriority')?.value || 'MEDIUM',
    };

    try {
        if (giftItemId) {
            await apiCall(`/registries/${registryId}/items/${giftItemId}`, 'PUT', payload);
            showNotification('Gift item updated.', 'success');
        } else {
            await apiCall(`/registries/${registryId}/items`, 'POST', payload);
            showNotification('Gift item created.', 'success');
        }

        if (registryId) {
            await loadManagedRegistry(registryId);
        }

        if (document.getElementById('managedGiftId')) document.getElementById('managedGiftId').value = '';
    } catch (error) {}
}

async function deleteGiftItem(registryId, itemId) {
    try {
        await apiCall(`/registries/${registryId}/items/${itemId}`, 'DELETE');
        showNotification('Gift item deleted.', 'success');
        await loadManagedRegistry(registryId);
    } catch (error) {}
}

async function advanceGiftItemStatus(registryId, itemId, nextStatus) {
    if (!nextStatus) {
        showNotification('This item cannot move to the next status.', 'error');
        return;
    }

    try {
        await apiCall(`/registries/${registryId}/items/${itemId}/status`, 'PATCH', { status: nextStatus });
        showNotification(`Gift item moved to ${nextStatus}.`, 'success');
        await loadManagedRegistry(registryId);
    } catch (error) {}
}

async function loadAdminConsole() {
    if (!canUseAdminUI()) {
        return;
    }

    const usersList = document.getElementById('adminUsersList');
    const registriesList = document.getElementById('adminRegistriesList');
    const auditLogsList = document.getElementById('auditLogsList');
    const exchangeRatesList = document.getElementById('exchangeRatesList');

    try {
        if (usersList) {
            const users = await apiCall('/admin/users');
            const data = users.data || users || [];
            usersList.innerHTML = data.length === 0 ? '<div class="alert alert-secondary mb-0">No users.</div>' : data.map((user) => `
                <div class="list-group-item">
                    <div class="d-flex justify-content-between align-items-start gap-3">
                        <div>
                            <strong>${escapeHtml(user.email)}</strong>
                            <div class="text-secondary small">${escapeHtml(user.role)}</div>
                        </div>
                        <div class="d-flex gap-2 align-items-center flex-wrap">
                            <select id="role-${user.id}" class="form-select form-select-sm w-auto">
                                <option value="GUEST" ${user.role === 'GUEST' ? 'selected' : ''}>GUEST</option>
                                <option value="REGISTRANT" ${user.role === 'REGISTRANT' ? 'selected' : ''}>REGISTRANT</option>
                                <option value="ADMIN" ${user.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
                            </select>
                            <button class="btn btn-outline-secondary btn-sm" type="button" onclick="updateUserRole(${user.id})">Save role</button>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        if (registriesList) {
            const registries = await apiCall('/admin/registries');
            const data = registries.data || registries || [];
            registriesList.innerHTML = data.length === 0 ? '<div class="alert alert-secondary mb-0">No registries.</div>' : data.map((registry) => `
                <div class="list-group-item">
                    <strong>${escapeHtml(registry.title)}</strong>
                    <div class="text-secondary small">Owner: ${registry.userId}</div>
                    <div class="text-secondary small">Status: ${escapeHtml(registry.status)}</div>
                </div>
            `).join('');
        }

        if (auditLogsList) {
            const logs = await apiCall('/admin/audit-logs');
            const data = logs.data || logs || [];
            auditLogsList.innerHTML = data.length === 0 ? '<div class="alert alert-secondary mb-0">No audit logs.</div>' : data.map((log) => `
                <div class="list-group-item">
                    <strong>${escapeHtml(log.action)}</strong>
                    <div class="text-secondary small">${escapeHtml(log.resourceType)} #${log.resourceId}</div>
                    <div class="text-secondary small">${new Date(log.createdAt).toLocaleString()}</div>
                </div>
            `).join('');
        }

        if (exchangeRatesList) {
            exchangeRatesList.innerHTML = '<div class="alert alert-light border mb-0">Use the form below to add a new exchange-rate snapshot.</div>';
        }
    } catch (error) {
        if (usersList) usersList.innerHTML = '<div class="alert alert-danger mb-0">Failed to load admin users.</div>';
        if (registriesList) registriesList.innerHTML = '<div class="alert alert-danger mb-0">Failed to load admin registries.</div>';
        if (auditLogsList) auditLogsList.innerHTML = '<div class="alert alert-danger mb-0">Failed to load audit logs.</div>';
    }
}

async function updateUserRole(userId) {
    const role = document.getElementById(`role-${userId}`)?.value;
    if (!role) return;

    try {
        await apiCall(`/admin/users/${userId}/role`, 'PATCH', { role });
        showNotification('User role updated.', 'success');
        await loadAdminConsole();
    } catch (error) {}
}

async function handleCreateExchangeRate(event) {
    event.preventDefault();
    const fromCurrency = document.getElementById('exchangeFrom')?.value;
    const toCurrency = document.getElementById('exchangeTo')?.value;
    const rate = document.getElementById('exchangeRateValue')?.value;
    const source = document.getElementById('exchangeSource')?.value;

    try {
        await apiCall('/admin/exchange-rates', 'PATCH', { fromCurrency, toCurrency, rate, source });
        showNotification('Exchange rate saved.', 'success');
        await loadAdminConsole();
    } catch (error) {}
}
