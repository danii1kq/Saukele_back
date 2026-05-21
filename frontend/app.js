// API URL uses same host as frontend because of nginx proxy
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';
let accessToken = localStorage.getItem('accessToken');
let refreshToken = localStorage.getItem('refreshToken');

function showNotification(message, type = 'success') {
    const notif = document.getElementById('notification');
    if (!notif) {
        alert(message);
        return;
    }
    notif.textContent = message;
    notif.className = `notification ${type}`;
    notif.style.display = 'block';
    setTimeout(() => { notif.style.display = 'none'; }, 5000);
}

function updateUI() {
    const linkLogin = document.getElementById('linkLogin');
    const linkRegister = document.getElementById('linkRegister');
    const linkDashboard = document.getElementById('linkDashboard');
    const btnLogout = document.getElementById('btnLogout');
    const currentUser = document.getElementById('currentUser');

    if (accessToken) {
        // Logged in
        if(linkLogin) linkLogin.style.display = 'none';
        if(linkRegister) linkRegister.style.display = 'none';
        if(linkDashboard) linkDashboard.style.display = 'inline-block';
        if(btnLogout) btnLogout.style.display = 'inline-block';
        
        if (currentUser) {
            try {
                const payload = JSON.parse(atob(accessToken.split('.')[1]));
                currentUser.textContent = payload.email || 'User';
            } catch (e) {
                currentUser.textContent = 'Auth User';
            }
        }
    } else {
        // Not logged in
        if(linkLogin) linkLogin.style.display = 'inline-block';
        if(linkRegister) linkRegister.style.display = 'inline-block';
        if(linkDashboard) linkDashboard.style.display = 'none';
        if(btnLogout) btnLogout.style.display = 'none';
        if(currentUser) currentUser.textContent = '';
    }
}

document.addEventListener('DOMContentLoaded', updateUI);

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

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        const data = await apiCall('/auth/login', 'POST', { email, password });
        if (data.accessToken) {
            accessToken = data.accessToken;
            refreshToken = data.refreshToken;
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
            showNotification('Login successful!', 'success');
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
        }
    } catch (e) { }
}

async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const name = document.getElementById('name').value;
    try {
        await apiCall('/auth/register', 'POST', { email, password, name });
        showNotification('Registration successful!', 'success');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
    } catch (e) {}
}

async function handleResendVerification() {
    const email = document.getElementById('email').value;
    if (!email) return showNotification('Please enter your email first.', 'error');
    try {
        await apiCall('/auth/resend-verification', 'POST', { email });
        showNotification('Verification email resent.', 'success');
    } catch (e) {}
}

async function handleForgotPassword() {
    const email = document.getElementById('email').value;
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
    list.innerHTML = 'Loading...';
    try {
        const res = await apiCall('/registries');
        const data = res.data || res;
        list.innerHTML = data.length === 0 ? 'No registries found.' : data.map(r => `
            <div class="list-item">
                <strong>ID: ${r.id} | ${r.title}</strong><br>
                Couple: ${r.coupleName}<br>
                Date: ${new Date(r.weddingDate).toLocaleDateString()}<br>
                Status: ${r.status}
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = 'Failed to load registries.';
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
    list.innerHTML = 'Loading...';
    try {
        const res = await apiCall('/family-members');
        const data = res.data || res;
        list.innerHTML = (!data || data.length === 0) ? 'No family members found.' : data.map(f => `
            <div class="list-item">
                <strong>${f.name}</strong> (${f.kinshipTier})<br>
                Relationship: ${f.relationshipType}<br>
                Related user: ${f.relatedUserId || 'N/A'}
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = 'Failed to load family members.';
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
    list.innerHTML = 'Loading...';
    try {
        const res = await apiCall(`/registries/${regId}/items`);
        const gifts = res.data || res;
        list.innerHTML = (!gifts || gifts.length === 0) ? 'No gifts in this registry.' : gifts.map(g => `
            <div class="list-item">
                <strong>ID: ${g.id} | ${g.title}</strong><br>
                Target: ${g.targetAmountKzt} KZT<br>
                Current: ${g.currentAmountKzt || 0} KZT<br>
                Status: ${g.status} | priority: ${g.priority || 'N/A'}
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = 'Failed to load gifts.';
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
