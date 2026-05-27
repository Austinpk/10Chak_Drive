/**
 * ================================================================
 *  10CHAK DRIVE — app.js
 *  Two-Step OTP State Machine + Firebase v10 Auth + Firestore
 *  Project: chak-drive-fe6e5  |  Sender #: 14101294768
 *
 *  FLOW DIAGRAM:
 *  ─────────────────────────────────────────────────────────────
 *
 *  [Screen 1: Role Select]
 *       │
 *       ▼ app.showForm('customer' | 'rider')
 *
 *  [Screen 2: Registration Form]   ← OTP_STEP = 'idle'
 *       │
 *       ▼ app.handleSubmit()  →  validates fields
 *       │                    →  signInWithPhoneNumber()
 *       │                    →  stores confirmationResult
 *       ▼
 *  [OTP Panel slides in]           ← OTP_STEP = 'awaiting_code'
 *       │   (registration fields locked/dimmed)
 *       │   (6-digit input focused)
 *       │   (60s resend countdown)
 *       │
 *       ▼ app.handleSubmit()  →  confirmationResult.confirm(code)
 *       │                    →  addDoc() to Firestore
 *       ▼
 *  [Success toast → back to Screen 1]  ← OTP_STEP = 'idle'
 *
 *  ─────────────────────────────────────────────────────────────
 *  NOTE: reCAPTCHA v2 invisible is mounted on #recaptcha-container
 *  (already present in your index.html)
 * ================================================================
 */

// ── Firebase v10 SDK ───────────────────────────────────────────
import { initializeApp }
    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
    getAuth,
    RecaptchaVerifier,
    signInWithPhoneNumber
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

// Keep auth locale in sync with browser (SMS language)
auth.useDeviceLanguage();

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
        const label   = overlay.querySelector('.loading-text');
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
        phone:      {
            required: true,
            // Accepts 03XXXXXXXXX  — converted to +92 before sending
            pattern:    /^03[0-9]{9}$/,
            label:      'Phone Number',
            patternMsg: 'Must be 11 digits starting with 03 (e.g. 03001234567)'
        },
        vehicleNum: { required: false, label: 'Number Plate' },
        licenseNum: { required: false, label: 'License Number' },
        otpCode:    {
            required: true,
            pattern:    /^[0-9]{6}$/,
            label:      'OTP Code',
            patternMsg: 'Enter the 6-digit code sent to your phone'
        }
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
        const fieldIds = ['fullName', 'phone'];
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

    /**
     * customers/{uid}
     * uid = Firebase Auth UID from phone sign-in
     */
    async saveCustomer(uid, data) {
        try {
            const ref = await addDoc(collection(db, 'customers'), {
                uid,
                fullName:  data.fullName,
                phone:     data.phone,
                createdAt: serverTimestamp()
            });
            console.log('✅ Customer saved:', ref.id);
            return { success: true, id: ref.id };
        } catch (err) {
            console.error('❌ Firestore [customers]:', err.code, err.message);
            return { success: false, error: _friendlyError(err) };
        }
    },

    /**
     * riders/{uid}
     * status always starts as 'pending' — admin must approve
     */
    async saveRider(uid, data) {
        try {
            const ref = await addDoc(collection(db, 'riders'), {
                uid,
                fullName:    data.fullName,
                phone:       data.phone,
                vehicleType: data.vehicleType,
                vehicleNum:  data.vehicleNum,
                licenseNum:  data.licenseNum,
                status:      'pending',
                createdAt:   serverTimestamp()
            });
            console.log('✅ Rider saved:', ref.id);
            return { success: true, id: ref.id };
        } catch (err) {
            console.error('❌ Firestore [riders]:', err.code, err.message);
            return { success: false, error: _friendlyError(err) };
        }
    }
};

function _friendlyError(err) {
    const map = {
        'permission-denied':   'Database permission denied. Check Firestore rules.',
        'unavailable':         'Network issue — please check your connection.',
        'not-found':           'Database not found. Enable Firestore in Console.',
        'failed-precondition': 'Firestore not enabled yet.',
        'auth/invalid-phone-number':     'Invalid phone number format.',
        'auth/too-many-requests':        'Too many attempts. Please wait a few minutes.',
        'auth/invalid-verification-code':'Wrong OTP code. Please try again.',
        'auth/code-expired':             'OTP expired. Please request a new one.',
        'auth/quota-exceeded':           'SMS quota exceeded. Try again later.',
        'auth/captcha-check-failed':     'reCAPTCHA check failed. Please reload the page.'
    };
    return map[err.code] || err.message || 'Unknown error — please try again.';
}


/* ================================================================
   OTP PANEL — builds and manages the inline OTP step UI
   ================================================================ */
const OTPPanel = {

    _timerInterval: null,

    /**
     * Inject the OTP step panel right after #riderFields / before the submit btn.
     * Called once; subsequent shows/hides toggle .hidden.
     */
    inject() {
        if (document.getElementById('otpPanel')) return; // already injected

        const panel = document.createElement('div');
        panel.id        = 'otpPanel';
        panel.className = 'otp-panel hidden';
        panel.innerHTML = `
            <div class="otp-panel__header">
                <div class="otp-panel__icon"><i class="fa-solid fa-mobile-screen-button"></i></div>
                <div>
                    <p class="otp-panel__title">Enter Verification Code</p>
                    <p class="otp-panel__sub" id="otpSentTo">Code sent to your number</p>
                </div>
            </div>

            <div class="input-group" id="grp-otpCode">
                <label for="otpCode">
                    <i class="fa-solid fa-key"></i> 6-Digit OTP Code
                </label>
                <div class="input-wrapper otp-input-wrapper">
                    <input type="number" id="otpCode" inputmode="numeric"
                           placeholder="——  ——  ——"
                           maxlength="6" autocomplete="one-time-code"
                           oninput="app.onOtpInput(this)">
                </div>
                <span class="field-error" id="err-otpCode"></span>
            </div>

            <div class="otp-panel__footer">
                <span class="otp-timer" id="otpTimerText">Resend in <b id="otpCountdown">60</b>s</span>
                <button type="button" class="otp-resend-btn hidden"
                        id="otpResendBtn" onclick="app.resendOtp()">
                    <i class="fa-solid fa-rotate-right"></i> Resend OTP
                </button>
            </div>
        `;

        // Insert before the submit button
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.parentNode.insertBefore(panel, submitBtn);
    },

    show(phoneDisplay) {
        const panel = document.getElementById('otpPanel');
        if (!panel) return;
        document.getElementById('otpSentTo').textContent =
            `Code sent to ${phoneDisplay}`;
        panel.classList.remove('hidden');
        // Small delay so CSS transition plays
        requestAnimationFrame(() => panel.classList.add('otp-panel--visible'));
        // Focus the OTP input
        setTimeout(() => {
            const inp = document.getElementById('otpCode');
            if (inp) { inp.value = ''; inp.focus(); }
        }, 320);
        this._startTimer();
    },

    hide() {
        const panel = document.getElementById('otpPanel');
        if (!panel) return;
        panel.classList.remove('otp-panel--visible');
        setTimeout(() => panel.classList.add('hidden'), 280);
        this._clearTimer();
        const inp = document.getElementById('otpCode');
        if (inp) inp.value = '';
        // clear validation state
        const grp = document.getElementById('grp-otpCode');
        const err = document.getElementById('err-otpCode');
        if (grp) grp.classList.remove('valid', 'error');
        if (err) err.textContent = '';
    },

    _startTimer(seconds = 60) {
        this._clearTimer();
        let remaining = seconds;
        const countdown = document.getElementById('otpCountdown');
        const timerText = document.getElementById('otpTimerText');
        const resendBtn = document.getElementById('otpResendBtn');

        if (countdown) countdown.textContent = remaining;
        if (timerText) timerText.classList.remove('hidden');
        if (resendBtn) resendBtn.classList.add('hidden');

        this._timerInterval = setInterval(() => {
            remaining--;
            if (countdown) countdown.textContent = remaining;
            if (remaining <= 0) {
                this._clearTimer();
                if (timerText) timerText.classList.add('hidden');
                if (resendBtn) resendBtn.classList.remove('hidden');
            }
        }, 1000);
    },

    _clearTimer() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
    }
};


/* ================================================================
   APP STATE MACHINE
   ================================================================ */
const AppState = {

    // ── State properties ──────────────────────────────────────
    isRider:           false,
    otpStep:           'idle',         // 'idle' | 'awaiting_code'
    confirmationResult: null,          // Firebase ConfirmationResult object
    _recaptchaVerifier: null,          // RecaptchaVerifier instance
    _pendingPayload:   null,           // form data held between steps
    els:               {},

    // ── Boot ──────────────────────────────────────────────────
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

        // Pre-inject OTP panel into DOM (hidden) so it's ready
        OTPPanel.inject();

        this._startClock();
        this._initRecaptcha();

        console.log('✅ AppState ready | OTP state machine initialised');
    },

    // ── reCAPTCHA setup ───────────────────────────────────────
    // Firebase Phone Auth requires reCAPTCHA. We use 'invisible'
    // so the user never sees a challenge unless Google flags the request.
    _initRecaptcha() {
        try {
            this._recaptchaVerifier = new RecaptchaVerifier(
                auth,
                'recaptcha-container',   // div id in index.html
                {
                    size: 'invisible',
                    callback: () => {
                        // reCAPTCHA solved — signInWithPhoneNumber will proceed
                        console.log('reCAPTCHA solved ✅');
                    },
                    'expired-callback': () => {
                        console.warn('reCAPTCHA expired — will re-render on next attempt');
                        this._resetRecaptcha();
                    }
                }
            );
            // Pre-render so first OTP send is instant
            this._recaptchaVerifier.render().then(widgetId => {
                console.log('reCAPTCHA rendered, widgetId:', widgetId);
            });
        } catch (err) {
            console.warn('reCAPTCHA init skipped (likely SSR/test env):', err.message);
        }
    },

    _resetRecaptcha() {
        try {
            if (this._recaptchaVerifier) {
                this._recaptchaVerifier.clear();
                this._recaptchaVerifier = null;
            }
        } catch (_) { /* ignore */ }
        this._initRecaptcha();
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
        // Guard: confirm navigation if OTP was already sent
        if (this.otpStep === 'awaiting_code') {
            const sure = window.confirm('OTP bheji ja chuki hai. Kya aap wapas jaana chahte hain?');
            if (!sure) return;
        }
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
            this.els.submitText.textContent   = 'Submit for Verification';
            this.els.riderFields.classList.remove('hidden');
            this.els.formRoleIcon.innerHTML   = '<i class="fa-solid fa-motorcycle"></i>';
            this.els.formRoleIcon.className   = 'app-bar__role-icon app-bar__role-icon--amber';
            this.els.progressFill.style.width = '30%';
            this.els.progressLbl.textContent  = 'Step 1 of 3';
        } else {
            this.els.formTitle.textContent    = 'Customer Registration';
            this.els.formSubtitle.textContent = 'Quick OTP se register karein';
            this.els.submitText.textContent   = 'Verify via OTP';
            this.els.riderFields.classList.add('hidden');
            this.els.formRoleIcon.innerHTML   = '<i class="fa-solid fa-user"></i>';
            this.els.formRoleIcon.className   = 'app-bar__role-icon';
            this.els.progressFill.style.width = '50%';
            this.els.progressLbl.textContent  = 'Step 1 of 2';
        }
    },

    // ── Real-time field validation ────────────────────────────
    validateField(el) {
        if (this.otpStep === 'awaiting_code') return; // lock registration fields
        Validator.validateOne(el, this.isRider);
        this._updateProgress();
    },

    onOtpInput(el) {
        // Strip non-digits, cap at 6
        el.value = el.value.replace(/\D/g, '').slice(0, 6);
        Validator.validateOne(el, false);
        // Auto-submit when all 6 digits entered
        if (el.value.length === 6) {
            setTimeout(() => this.handleSubmit(), 200);
        }
    },

    _updateProgress() {
        const fieldIds = ['fullName', 'phone'];
        if (this.isRider) fieldIds.push('vehicleNum', 'licenseNum');
        const filled = fieldIds.filter(id => {
            const el = document.getElementById(id);
            return el && el.value.trim().length > 0;
        }).length;
        this.els.progressFill.style.width =
            Math.round((filled / fieldIds.length) * 70 + 10) + '%';
    },

    // ── Master submit dispatcher ──────────────────────────────
    // Called by onclick="app.handleSubmit()" in HTML every time.
    // Routes to the correct step based on this.otpStep.
    async handleSubmit() {
        UI.triggerRipple(this.els.submitBtn);

        if (this.otpStep === 'idle') {
            await this._step1_sendOtp();
        } else if (this.otpStep === 'awaiting_code') {
            await this._step2_verifyOtp();
        }
    },

    // ── STEP 1: Validate form → send OTP ─────────────────────
    async _step1_sendOtp() {
        // 1a. Validate all registration fields
        if (!Validator.validateAll(this.isRider)) {
            UI.toast('error', 'Form Incomplete', 'Please fix the highlighted fields.');
            document.querySelector('.input-group.error')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // 1b. Snapshot the form data (so user can't edit mid-flow)
        this._pendingPayload = this._collectFormData();

        // 1c. Convert local format  03XXXXXXXXX → +923XXXXXXXXX
        const e164Phone = '92' + this._pendingPayload.phone.slice(1);
        const phoneE164 = '+' + e164Phone;

        UI.setLoading(true, 'Sending OTP...');
        this.els.submitBtn.classList.add('loading');

        try {
            // 1d. Fire SMS via Firebase Auth
            this.confirmationResult = await signInWithPhoneNumber(
                auth,
                phoneE164,
                this._recaptchaVerifier
            );

            UI.setLoading(false);
            this.els.submitBtn.classList.remove('loading');

            // 1e. Transition UI to OTP-entry state
            this._enterOtpStep(this._pendingPayload.phone);

        } catch (err) {
            UI.setLoading(false);
            this.els.submitBtn.classList.remove('loading');
            console.error('signInWithPhoneNumber error:', err.code, err.message);
            // Reset reCAPTCHA so next attempt works
            this._resetRecaptcha();
            UI.toast('error', 'OTP Failed', _friendlyError(err));
        }
    },

    // ── STEP 2: Verify code → save to Firestore ───────────────
    async _step2_verifyOtp() {
        const otpInput = document.getElementById('otpCode');
        const code     = (otpInput?.value || '').trim();

        // 2a. Validate the OTP field
        if (!Validator.validateOne(otpInput, false)) {
            UI.toast('error', 'Invalid Code', 'Enter the 6-digit code from your SMS.');
            otpInput?.focus();
            return;
        }

        if (!this.confirmationResult) {
            UI.toast('error', 'Session Expired', 'Please go back and request a new OTP.');
            return;
        }

        UI.setLoading(true, 'Verifying code...');
        this.els.submitBtn.classList.add('loading');
        this.els.progressFill.style.width = '85%';

        try {
            // 2b. Confirm OTP with Firebase Auth
            const credential = await this.confirmationResult.confirm(code);
            const uid        = credential.user.uid;

            console.log('✅ Phone auth confirmed. UID:', uid);
            UI.setLoading(true, 'Saving profile...');

            // 2c. Save to Firestore using the confirmed UID
            const result = this.isRider
                ? await DataService.saveRider(uid, this._pendingPayload)
                : await DataService.saveCustomer(uid, this._pendingPayload);

            UI.setLoading(false);
            this.els.submitBtn.classList.remove('loading');

            if (!result.success) throw new Error(result.error);

            // 2d. Success
            this.els.progressFill.style.width = '100%';

            if (this.isRider) {
                UI.toast(
                    'success',
                    'Application Logged!',
                    'Verification pending against government database fields.'
                );
            } else {
                UI.toast(
                    'success',
                    'Account Initialized!',
                    'Phone number verified. Welcome to 10Chak Drive!'
                );
            }

            setTimeout(() => this.showRoleScreen(), 2500);

        } catch (err) {
            UI.setLoading(false);
            this.els.submitBtn.classList.remove('loading');
            console.error('OTP confirm / Firestore error:', err.code, err.message);

            if (err.code === 'auth/invalid-verification-code' ||
                err.code === 'auth/code-expired') {
                // Highlight OTP field as invalid
                const grp = document.getElementById('grp-otpCode');
                const errEl = document.getElementById('err-otpCode');
                if (grp) grp.classList.add('error');
                if (errEl) errEl.textContent = _friendlyError(err);
                otpInput?.select();
            }

            UI.toast('error', 'Verification Failed', _friendlyError(err));
        }
    },

    // ── Resend OTP (called from HTML onclick) ─────────────────
    async resendOtp() {
        if (!this._pendingPayload) return;

        const phoneE164 = '+92' + this._pendingPayload.phone.slice(1);

        const resendBtn = document.getElementById('otpResendBtn');
        if (resendBtn) resendBtn.classList.add('hidden');

        UI.setLoading(true, 'Resending OTP...');
        this._resetRecaptcha();

        // Brief pause for reCAPTCHA to re-render
        await new Promise(r => setTimeout(r, 800));

        try {
            this.confirmationResult = await signInWithPhoneNumber(
                auth,
                phoneE164,
                this._recaptchaVerifier
            );
            UI.setLoading(false);
            UI.toast('info', 'OTP Resent', `New code sent to ${this._pendingPayload.phone}`);
            OTPPanel._startTimer(60);
        } catch (err) {
            UI.setLoading(false);
            console.error('Resend error:', err.code);
            if (resendBtn) resendBtn.classList.remove('hidden');
            UI.toast('error', 'Resend Failed', _friendlyError(err));
        }
    },

    // ── UI state: enter OTP step ──────────────────────────────
    _enterOtpStep(phoneDisplay) {
        this.otpStep = 'awaiting_code';

        // Lock registration fields visually
        const formSections = document.querySelectorAll('.form-section');
        formSections.forEach(s => s.classList.add('form-section--locked'));

        // Show OTP panel
        OTPPanel.show(phoneDisplay);

        // Update progress & subtitle
        this.els.progressFill.style.width = '65%';
        this.els.progressLbl.textContent  =
            this.isRider ? 'Step 2 of 3' : 'Step 2 of 2';

        // Update button label & icon
        this.els.submitText.textContent = 'Confirm OTP';
        if (this.els.submitIcon) {
            this.els.submitIcon.className = 'fa-solid fa-shield-check btn-icon';
        }

        // Update subtitle
        this.els.formSubtitle.textContent = 'Enter the code from your SMS';

        UI.toast(
            'info',
            'OTP Bheji Gai!',
            `Verification code sent to ${phoneDisplay}`
        );
    },

    // ── UI state: exit OTP step (reset) ──────────────────────
    _exitOtpStep() {
        this.otpStep            = 'idle';
        this.confirmationResult = null;
        this._pendingPayload    = null;

        // Unlock registration fields
        document.querySelectorAll('.form-section')
            .forEach(s => s.classList.remove('form-section--locked'));

        // Hide OTP panel
        OTPPanel.hide();

        // Restore button
        this.els.submitText.textContent = this.isRider
            ? 'Submit for Verification' : 'Verify via OTP';
        if (this.els.submitIcon) {
            this.els.submitIcon.className = 'fa-solid fa-paper-plane btn-icon';
        }
        this._configureForm();
    },

    // ── Helpers ───────────────────────────────────────────────
    _collectFormData() {
        const base = {
            fullName: document.getElementById('fullName').value.trim(),
            phone:    document.getElementById('phone').value.trim(),
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
        this._exitOtpStep();
        this.els.regForm.reset();
        this._clearAllValidation();
        this.isRider = false;
    },

    _clearAllValidation() {
        ['fullName', 'phone', 'vehicleNum', 'licenseNum', 'otpCode'].forEach(id => {
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


/* ================================================================
   BOOT + CSS FOR OTP PANEL (injected programmatically so the
   OTP panel doesn't need a separate stylesheet edit)
   ================================================================ */
(function injectOtpStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* OTP Panel */
        .otp-panel {
            background: linear-gradient(135deg, #e8f5e9, #f0fff4);
            border: 1.5px solid #a5d6a7;
            border-radius: 14px;
            padding: 18px 16px 14px;
            margin-bottom: 18px;
            transform: translateY(12px);
            opacity: 0;
            transition: opacity 0.28s ease, transform 0.28s cubic-bezier(0.34,1.56,0.64,1);
        }
        .otp-panel--visible {
            opacity: 1;
            transform: translateY(0);
        }
        .otp-panel__header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }
        .otp-panel__icon {
            width: 42px; height: 42px;
            background: #2e7d32;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            color: #fff;
            font-size: 18px;
            flex-shrink: 0;
            box-shadow: 0 4px 12px rgba(46,125,50,0.3);
        }
        .otp-panel__title {
            font-family: 'Baloo Bhaijaan 2', cursive;
            font-size: 15px; font-weight: 700;
            color: #1b5e20;
        }
        .otp-panel__sub {
            font-size: 12px; color: #558b2f; font-weight: 500;
        }
        /* Large OTP input */
        #grp-otpCode .input-wrapper input {
            font-size: 26px;
            font-weight: 800;
            letter-spacing: 10px;
            text-align: center;
            padding: 14px 10px;
            background: #fff;
            border: 2px solid #a5d6a7;
            border-radius: 12px;
            color: #1b5e20;
        }
        #grp-otpCode .input-wrapper input:focus {
            border-color: #2e7d32;
            box-shadow: 0 0 0 3px rgba(46,125,50,0.15);
        }
        /* Hide browser number spinners */
        #otpCode::-webkit-inner-spin-button,
        #otpCode::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        #otpCode { -moz-appearance: textfield; }

        .otp-panel__footer {
            display: flex; align-items: center;
            justify-content: center;
            margin-top: 10px; gap: 8px;
        }
        .otp-timer {
            font-size: 13px; color: #558b2f; font-weight: 600;
        }
        .otp-resend-btn {
            background: none; border: 1.5px solid #2e7d32;
            color: #2e7d32; border-radius: 50px;
            padding: 6px 16px; font-size: 13px; font-weight: 700;
            cursor: pointer; display: flex; align-items: center; gap: 6px;
            transition: all 0.2s ease;
        }
        .otp-resend-btn:hover { background: #e8f5e9; }

        /* Locked form section */
        .form-section--locked {
            opacity: 0.45;
            pointer-events: none;
            user-select: none;
            filter: grayscale(0.3);
            transition: opacity 0.3s ease;
        }
    `;
    document.head.appendChild(style);
})();

document.addEventListener('DOMContentLoaded', () => AppState.init());

// ✅ Bound to window — all inline onclick="app.X()" calls work
window.app = AppState;