/**
================================================================
10CHAK DRIVE — app.js (Email Magic Link Version)
FREE Firebase Auth (No SMS Billing required)
================================================================
*/
// ── Firebase v10 SDK ───────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    sendSignInLinkToEmail, 
    isSignInWithEmailLink, 
    signInWithEmailLink 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase Config ────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyAcx_9MOv5drJ9eN-x6U6R8CQLu4rVeiiM",
    authDomain:        "chak-drive-fe6e5.firebaseapp.com",
    projectId:         "chak-drive-fe6e5",
    storageBucket:     "chak-drive-fe6e5.firebasestorage.app",
    messagingSenderId: "14101294768",
    appId:             "1:14101294768:web:bdc924c166aca82aea9575"
};

const _app  = initializeApp(firebaseConfig);
const auth  = getAuth(_app);
const db    = getFirestore(_app);

console.log("✅ Firebase ready →", firebaseConfig.projectId);

/* ================================================================
UI MODULE
================================================================ */
const UI = {
    toast(type = 'success', title = '', message = '', duration = 4500) {
        const container = document.getElementById('toastContainer');
        const iconMap   = {
            success: 'fa-circle-check',
            error:   'fa-circle-exclamation',
            info:    'fa-circle-info'
        };
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        el.innerHTML = `
            <span class="toast__icon"><i class="fa-solid ${iconMap[type]}"></i></span>
            <div class="toast__body">
                <span class="toast__title">${title}</span>
                ${message ? `<span class="toast__msg">${message}</span>` : ''}
            </div>`;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('toast-out');
            el.addEventListener('animationend', () => el.remove(), { once: true });
        }, duration);
    },

    setLoading(visible, text = 'Please wait...') {
        const overlay = document.getElementById('loadingOverlay');
        const label    = overlay.querySelector('.loading-text');
        if (label) label.textContent = text;
        overlay.classList.toggle('hidden', !visible);
    },

    triggerRipple(btn) {
        const r = btn.querySelector('.btn-ripple');
        if (!r) return;
        Object.assign(r.style, {
            width: '10px', height: '10px',
            left: '50%', top: '50%',
            marginLeft: '-5px', marginTop: '-5px',
            animation: 'none'
        });
        void r.offsetWidth;
        r.style.animation = 'rippleEffect 0.55s ease-out forwards';
    }
};

/* ================================================================
VALIDATOR MODULE
================================================================ */
const Validator = {
    rules: {
        fullName:   { required: true,  minLength: 2,  label: 'Full Name' },
        email:      {
            required: true,
            pattern:    /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            label:      'Email Address',
            patternMsg: 'Please enter a valid email (e.g. name@gmail.com)'
        },
        vehicleNum:  { required: false, label: 'Number Plate' },
        licenseNum: { required: false, label: 'License Number' },
    },

    validateOne(el, isRider = false) {
        const id    = el.id;
        const rule  = this.rules[id];
        if (!rule) return true;

        const val   = el.value.trim();
        const group = document.getElementById(`grp-${id}`);
        const errEl = document.getElementById(`err-${id}`);
        if (!group) return true;

        const isRequired = rule.required ||
            (isRider && ['vehicleNum', 'licenseNum'].includes(id));

        let error = '';
        if (isRequired && val.length === 0) {
            error = `${rule.label} is required.`;
        } else if (val.length > 0 && rule.minLength && val.length < rule.minLength) {
            error = `${rule.label} must be at least ${rule.minLength} characters.`;
        } else if (val.length > 0 && rule.pattern && !rule.pattern.test(val)) {
            error = rule.patternMsg || `${rule.label} format is invalid.`;
        }

        if (error) {
            group.classList.remove('valid');
            group.classList.add('error');
            if (errEl) errEl.textContent = error;
            return false;
        }
        group.classList.remove('error');
        group.classList.toggle('valid', val.length > 0);
        if (errEl) errEl.textContent = '';
        return true;
    },

    validateAll(isRider) {
        const fieldIds = ['fullName', 'email'];
        if (isRider) fieldIds.push('vehicleNum', 'licenseNum');
        let ok = true;
        fieldIds.forEach(id => {
            const el = document.getElementById(id);
            if (el && !this.validateOne(el, isRider)) ok = false;
        });
        return ok;
    }
};

/* ================================================================
DATA SERVICE — Firestore writes
================================================================ */
const DataService = {
    async saveCustomer(uid, data) {
        try {
            const ref = await addDoc(collection(db, 'customers'), {
                uid,
                fullName:  data.fullName,
                email:     data.email,
                createdAt: serverTimestamp()
            });
            return { success: true, id: ref.id };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },

    async saveRider(uid, data) {
        try {
            const ref = await addDoc(collection(db, 'riders'), {
                uid,
                fullName:    data.fullName,
                email:       data.email,
                vehicleType: data.vehicleType,
                vehicleNum:  data.vehicleNum,
                licenseNum:  data.licenseNum,
                status:      'pending',
                createdAt:   serverTimestamp()
            });
            return { success: true, id: ref.id };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
};

/* ================================================================
APP STATE MACHINE
================================================================ */
const AppState = {
    isRider: false,
    pendingPayload: null,
    els: {},

    init() {
        this.els = {
            roleScreen:   document.getElementById('roleScreen'),
            formScreen:   document.getElementById('formScreen'),
            formTitle:    document.getElementById('formTitle'),
            formSubtitle: document.getElementById('formSubtitle'),
            formRoleIcon: document.getElementById('formRoleIcon'),
            riderFields:  document.getElementById('riderFields'),
            submitBtn:    document.getElementById('submitBtn'),
            submitText:   document.getElementById('submitBtnText'),
            submitIcon:   document.querySelector('#submitBtn .btn-icon'),
            regForm:      document.getElementById('regForm'),
            progressFill: document.getElementById('progressFill'),
            progressLbl:  document.getElementById('progressLabel'),
            statusTime:   document.getElementById('statusTime'),
        };

        this._startClock();
        
        // CHECK FOR EMAIL LINK RETURN
        if (isSignInWithEmailLink(auth, window.location.href)) {
            this._handleEmailLinkReturn();
        } else {
            console.log('✅ AppState ready');
        }
    },

    // ── Screen transitions ────────────────────────────────────
    showForm(role) {
        this.isRider = (role === 'rider');
        this.els.roleScreen.classList.add('screen-slide-out');
        
        setTimeout(() => {
            this.els.roleScreen.classList.remove('screen-active', 'screen-slide-out');
            this.els.roleScreen.classList.add('screen-hidden');
            this._configureForm();
            
            this.els.formScreen.classList.remove('screen-hidden');
            this.els.formScreen.classList.add('screen-active', 'screen-slide-in');
            setTimeout(() => this.els.formScreen.classList.remove('screen-slide-in'), 400);
            
            this._fullReset();
            document.getElementById('fullName').focus();
        }, 280);
    },

    showRoleScreen() {
        this.els.formScreen.classList.add('screen-slide-out');
        setTimeout(() => {
            this.els.formScreen.classList.remove('screen-active', 'screen-slide-out');
            this.els.formScreen.classList.add('screen-hidden');
            this.els.roleScreen.classList.remove('screen-hidden');
            this.els.roleScreen.classList.add('screen-active');
            this._fullReset();
        }, 280);
    },

    // ── Form configuration ────────────────────────────────────
    _configureForm() {
        if (this.isRider) {
            this.els.formTitle.textContent    = 'Rider Registration';
            this.els.formSubtitle.textContent = 'Apni vehicle details fill karein';
            this.els.submitText.textContent   = 'Send Verification Link';
            this.els.riderFields.classList.remove('hidden');
            this.els.formRoleIcon.innerHTML   = '<i class="fa-solid fa-motorcycle"></i>';
            this.els.formRoleIcon.className   = 'app-bar__role-icon app-bar__role-icon--amber';
            this.els.progressFill.style.width = '30%';
            this.els.progressLbl.textContent  = 'Step 1 of 3';
        } else {
            this.els.formTitle.textContent    = 'Customer Registration';
            this.els.formSubtitle.textContent = 'Email verification se register karein';
            this.els.submitText.textContent   = 'Send Verification Link';
            this.els.riderFields.classList.add('hidden');
            this.els.formRoleIcon.innerHTML   = '<i class="fa-solid fa-user"></i>';
            this.els.formRoleIcon.className   = 'app-bar__role-icon';
            this.els.progressFill.style.width = '50%';
            this.els.progressLbl.textContent  = 'Step 1 of 2';
        }
    },

    // ─ Validation ────────────────────────────────────
    validateField(el) {
        Validator.validateOne(el, this.isRider);
        this._updateProgress();
    },

    _updateProgress() {
        const fieldIds = ['fullName', 'email'];
        if (this.isRider) fieldIds.push('vehicleNum', 'licenseNum');
        const filled = fieldIds.filter(id => {
            const el = document.getElementById(id);
            return el && el.value.trim().length > 0;
        }).length;
        this.els.progressFill.style.width = Math.round((filled / fieldIds.length) * 70 + 10) + '%';
    },

    // ── Submit Handler ──────────────────────────────────────
    async handleSubmit() {
        UI.triggerRipple(this.els.submitBtn);

        if (!Validator.validateAll(this.isRider)) {
            UI.toast('error', 'Form Incomplete', 'Please fix the highlighted fields.');
            return;
        }

        this.pendingPayload = this._collectFormData();
        
        // If we are waiting for email link return, we don't send again
        if (window.location.href.includes('email=')) return;

        await this._sendMagicLink();
    },

    // ── Send Magic Link ─────────────────────────────────────
    async _sendMagicLink() {
        const email = this.pendingPayload.email;
        UI.setLoading(true, 'Sending verification link...');
        this.els.submitBtn.classList.add('loading');

        const actionCodeSettings = {
            url: 'http://127.0.0.1:5500/index.html', // Your local URL
            handleCodeInApp: true,
        };

        try {
            await sendSignInLinkToEmail(auth, email, actionCodeSettings);
            
            // Save email to localStorage so we can retrieve it when user comes back
            window.localStorage.setItem('emailForSignIn', email);
            
            UI.setLoading(false);
            this.els.submitBtn.classList.remove('loading');

            UI.toast(
                'success', 
                'Email Bhej Diya!', 
                'Apne email inbox check karein aur link par click karein.'
            );
            
            // Change button to show waiting state
            this.els.submitText.textContent = 'Checking Email...';
            this.els.submitBtn.disabled = true;
            this.els.submitBtn.style.opacity = '0.7';

        } catch (err) {
            UI.setLoading(false);
            this.els.submitBtn.classList.remove('loading');
            console.error('Link Send Error:', err.code, err.message);
            UI.toast('error', 'Failed', err.message);
        }
    },

    // ─ Handle Return from Email ────────────────────────────
    async _handleEmailLinkReturn() {
        UI.setLoading(true, 'Verifying Email...');
        
        try {
            let email = window.localStorage.getItem('emailForSignIn');
            
            // If user cleared cache or is on different device, ask for email
            if (!email) {
                email = window.prompt("Please provide your email for confirmation");
            }

            const result = await signInWithEmailLink(auth, email, window.location.href);
            const uid = result.user.uid;

            // Clean up storage and URL
            window.localStorage.removeItem('emailForSignIn');
            window.history.replaceState({}, document.title, window.location.pathname);

            // Save to Firestore
            UI.setLoading(true, 'Saving Profile...');
            const dataResult = this.isRider
                ? await DataService.saveRider(uid, this.pendingPayload || { email: email }) // Try to use payload if available
                : await DataService.saveCustomer(uid, this.pendingPayload || { email: email });

            UI.setLoading(false);

            if (dataResult.success) {
                UI.toast('success', 'Welcome to 10Chak!', 'Registration successful.');
                setTimeout(() => this.showRoleScreen(), 2000);
            } else {
                UI.toast('error', 'Error', 'Auth worked but saving data failed.');
            }

        } catch (err) {
            UI.setLoading(false);
            console.error('Sign In Link Error:', err);
            UI.toast('error', 'Verification Failed', 'Link may be expired. Try again.');
            // Redirect to form
            this.showRoleScreen();
        }
    },

    // ─ Helpers ───────────────────────────────────────────────
    _collectFormData() {
        const base = {
            fullName: document.getElementById('fullName').value.trim(),
            email:    document.getElementById('email').value.trim(),
        };
        if (this.isRider) {
            return {
                ...base,
                vehicleType: document.getElementById('vehicleType').value,
                vehicleNum:  document.getElementById('vehicleNum').value.trim().toUpperCase(),
                licenseNum:  document.getElementById('licenseNum').value.trim(),
            };
        }
        return base;
    },

    _fullReset() {
        this.els.regForm.reset();
        this._clearAllValidation();
        this.isRider = false;
        // Reset button state
        this.els.submitText.textContent = 'Send Verification Link';
        this.els.submitBtn.disabled = false;
        this.els.submitBtn.style.opacity = '1';
    },

    _clearAllValidation() {
        ['fullName', 'email', 'vehicleNum', 'licenseNum'].forEach(id => {
            const grp = document.getElementById(`grp-${id}`);
            const err = document.getElementById(`err-${id}`);
            if (grp) grp.classList.remove('valid', 'error');
            if (err) err.textContent = '';
        });
        if (this.els.progressFill) this.els.progressFill.style.width = '10%';
    },

    _startClock() {
        const tick = () => {
            const now = new Date();
            const h   = now.getHours() % 12 || 12;
            const m   = String(now.getMinutes()).padStart(2, '0');
            if (this.els.statusTime) this.els.statusTime.textContent = `${h}:${m}`;
        };
        tick();
        setInterval(tick, 30000);
    }
};

// Boot the app
window.app = AppState;
document.addEventListener('DOMContentLoaded', () => AppState.init());
