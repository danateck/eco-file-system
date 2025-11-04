// scriptLogin.js
// Cloud Firestore Version - All data stored in Firebase Firestore

// Firestore Database functions
async function loadUserDataFromFirestore(email) {
    try {
        const db = window.db;
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
        
        const userRef = doc(db, "users", email);
        const snapshot = await getDoc(userRef);
        
        if (snapshot.exists()) {
            return snapshot.data();
        }
        return null;
    } catch (err) {
        console.error("Error loading user data:", err);
        return null;
    }
}

async function saveUserDataToFirestore(email, userData) {
    try {
        const db = window.db;
        const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
        
        const userRef = doc(db, "users", email);
        await setDoc(userRef, userData, { merge: true });
        return true;
    } catch (err) {
        console.error("Error saving user data:", err);
        return false;
    }
}

async function setCurrentUser(email) {
  const norm = (email || "").trim().toLowerCase();
  console.log("Setting current user:", norm);
  sessionStorage.setItem("docArchiveCurrentUser", norm);
  const verify = sessionStorage.getItem("docArchiveCurrentUser");
  console.log("Verification - User stored in session:", verify);
}


async function getCurrentUser() {
    return sessionStorage.getItem("docArchiveCurrentUser");
}

class EcoWellnessLoginForm {
    constructor() {
        // אלמנטים מהדף
        this.form = document.getElementById('loginForm');
        this.emailInput = document.getElementById('email');
        this.passwordInput = document.getElementById('password');
        this.passwordToggle = document.getElementById('passwordToggle');
        this.submitButton = this.form.querySelector('.harmony-button');
        this.successMessage = document.getElementById('successMessage');
        this.socialButtons = document.querySelectorAll('.earth-social');
        this.forgotLink = document.querySelector(".healing-link");

        // Firebase
        this.auth = null;
        this.db = null;
        this.googleProvider = null;
        this.signInWithEmailAndPassword = null;
        this.createUserWithEmailAndPassword = null;
        this.signInWithPopup = null;
        this.sendPasswordResetEmail = null;

        this.init();
    }

    async init() {
        await this.initFirebase();
        this.bindEvents();
        this.setupPasswordToggle();
        this.setupWellnessEffects();
        this.setupGoogleButton();
        this.setupForgotPassword();
    }

    async initFirebase() {
        try {
            const [appModule, authModule, firestoreModule] = await Promise.all([
                import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
                import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js"),
                import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js")
            ]);

            const { initializeApp } = appModule;
            const { 
                getAuth, 
                GoogleAuthProvider, 
                signInWithPopup,
                signInWithEmailAndPassword,
                createUserWithEmailAndPassword,
                sendPasswordResetEmail
            } = authModule;
            const { getFirestore } = firestoreModule;

            const firebaseConfig = {
                apiKey: "AIzaSyBPr4X2_8JYCgXzMlTcVB0EJLhup9CdyYw",
                authDomain: "login-page-echo-file.firebaseapp.com",
                projectId: "login-page-echo-file",
                storageBucket: "login-page-echo-file.firebasestorage.app",
                messagingSenderId: "200723524735",
                appId: "1:200723524735:web:9eaed6ef10cbc2c406234a",
                measurementId: "G-LT5XQFQPKP"
            };

            const firebaseApp = initializeApp(firebaseConfig);
            this.auth = getAuth(firebaseApp);
            this.db = getFirestore(firebaseApp);
            this.googleProvider = new GoogleAuthProvider();
            
            // Store auth functions
            this.signInWithPopup = signInWithPopup;
            this.signInWithEmailAndPassword = signInWithEmailAndPassword;
            this.createUserWithEmailAndPassword = createUserWithEmailAndPassword;
            this.sendPasswordResetEmail = sendPasswordResetEmail;

            // Make auth and db globally available
            window.auth = this.auth;
            window.db = this.db;

            console.log("Firebase initialized successfully");
        } catch (err) {
            console.error("Firebase initialization error:", err);
            alert("שגיאה באתחול המערכת. אנא רענני את הדף.");
        }
    }

    bindEvents() {
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));

        this.emailInput.addEventListener('blur', () => this.validateEmail());
        this.passwordInput.addEventListener('blur', () => this.validatePassword());
        this.emailInput.addEventListener('input', () => this.clearError('email'));
        this.passwordInput.addEventListener('input', () => this.clearError('password'));

        this.emailInput.setAttribute('placeholder', ' ');
        this.passwordInput.setAttribute('placeholder', ' ');
    }

    setupPasswordToggle() {
        if (!this.passwordToggle) return;
        this.passwordToggle.addEventListener('click', () => {
            const type = this.passwordInput.type === 'password' ? 'text' : 'password';
            this.passwordInput.type = type;
            this.passwordToggle.classList.toggle('toggle-visible', type === 'text');
        });
    }

    setupForgotPassword() {
        if (!this.forgotLink) return;

        this.forgotLink.addEventListener("click", async (e) => {
            e.preventDefault();
            await this.handleForgotPassword();
        });
    }

    async handleForgotPassword() {
        const email = this.emailInput.value.trim();

        if (!email) {
            alert("כדי לאפס סיסמה, הזיני קודם את כתובת האימייל שלך.");
            this.emailInput.focus();
            return;
        }

        try {
            await this.sendPasswordResetEmail(this.auth, email);
            alert("נשלח אליך מייל לאיפוס סיסמה. בדקי את תיבת הדואר שלך.");
        } catch (err) {
            console.error("Password reset error:", err);
            if (err.code === "auth/user-not-found") {
                alert("לא נמצא משתמש עם כתובת המייל הזו.");
            } else {
                alert("שגיאה בשליחת מייל לאיפוס סיסמה. נסי שוב מאוחר יותר.");
            }
        }
    }

    setupWellnessEffects() {
        [this.emailInput, this.passwordInput].forEach(input => {
            input.addEventListener('focus', (e) => {
                this.triggerMindfulEffect(e.target.closest('.organic-field'));
            });
            input.addEventListener('blur', (e) => {
                this.resetMindfulEffect(e.target.closest('.organic-field'));
            });
        });
    }

    triggerMindfulEffect(field) {
        const fieldNature = field?.querySelector('.field-nature');
        if (fieldNature) {
            fieldNature.style.animation = 'gentleBreath 3s ease-in-out infinite';
        }
    }

    resetMindfulEffect(field) {
        const fieldNature = field?.querySelector('.field-nature');
        if (fieldNature) {
            fieldNature.style.animation = '';
        }
    }

    validateEmail() {
        const email = this.emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email) {
            this.showError('email', 'אנא הזיני כתובת אימייל');
            return false;
        }
        if (!emailRegex.test(email)) {
            this.showError('email', 'כתובת האימייל אינה חוקית');
            return false;
        }

        this.clearError('email');
        return true;
    }

    validatePassword() {
        const password = this.passwordInput.value;
        if (!password) {
            this.showError('password', 'נא להזין סיסמה');
            return false;
        }
        if (password.length < 6) {
            this.showError('password', 'הסיסמה קצרה מדי (לפחות 6 תווים)');
            return false;
        }

        this.clearError('password');
        return true;
    }

    showError(field, message) {
        const organicField = document.getElementById(field)?.closest('.organic-field');
        const errorElement = document.getElementById(`${field}Error`);
        if (organicField && errorElement) {
            organicField.classList.add('error');
            errorElement.textContent = message;
            errorElement.classList.add('show');
        } else {
            alert(message);
        }
    }

    clearError(field) {
        const organicField = document.getElementById(field)?.closest('.organic-field');
        const errorElement = document.getElementById(`${field}Error`);
        if (organicField && errorElement) {
            organicField.classList.remove('error');
            errorElement.classList.remove('show');
            setTimeout(() => {
                errorElement.textContent = '';
            }, 300);
        }
    }

    setLoading(loading) {
        this.submitButton.classList.toggle('loading', loading);
        this.submitButton.disabled = loading;
        this.socialButtons.forEach(button => {
            button.style.pointerEvents = loading ? 'none' : 'auto';
            button.style.opacity = loading ? '0.6' : '1';
        });
    }

    async handleSubmit(e) {
        e.preventDefault();

        const okEmail = this.validateEmail();
        const okPass = this.validatePassword();
        if (!okEmail || !okPass) return;

        this.setLoading(true);

        const email = this.emailInput.value.trim();
        const password = this.passwordInput.value.trim();

        console.log("=== LOGIN ATTEMPT ===");
        console.log("Email:", email);

        try {
            // Try to sign in
            console.log("Attempting signInWithEmailAndPassword...");
            const userCred = await this.signInWithEmailAndPassword(this.auth, email, password);
            console.log("Sign in successful:", userCred);
            await this.finishLogin(email);

        } catch (err) {
            const code = err.code || "";
            const msg = err.message || "";

            console.log("Login error code:", code);
            console.log("Login error message:", msg);

            // Wrong password
            if (code === "auth/wrong-password") {
                this.showError("password", "סיסמה שגויה");
                this.passwordInput.focus();
                this.setLoading(false);
                return;
            }

            // User not found - create new user
            if (code === "auth/user-not-found") {
                try {
                    console.log("User not found, creating new user...");
                    const newUserCred = await this.createUserWithEmailAndPassword(this.auth, email, password);
                    console.log("New user created:", newUserCred);
                    await this.finishLogin(email, true);
                    return;
                } catch (createErr) {
                    console.error("Create user failed:", createErr);
                    this.showError("password", "לא ניתן ליצור משתמש חדש. בדקי שהסיסמה באורך 6+ תווים.");
                    this.setLoading(false);
                    return;
                }
            }

            // Safari/mobile internal error
            if (code === "auth/internal-error" && msg.includes("INVALID_LOGIN_CREDENTIALS")) {
                try {
                    console.log("Internal error, trying to create user...");
                    const newUserCred = await this.createUserWithEmailAndPassword(this.auth, email, password);
                    console.log("New user created:", newUserCred);
                    await this.finishLogin(email, true);
                    return;
                } catch (createErr) {
                    const createCode = createErr.code || "";
                    if (createCode === "auth/email-already-in-use") {
                        this.showError("password", "סיסמה שגויה");
                        this.passwordInput.focus();
                        this.setLoading(false);
                    } else {
                        console.error("Create user failed:", createErr);
                        this.showError("password", "לא ניתן ליצור משתמש חדש.");
                        this.setLoading(false);
                    }
                    return;
                }
            }

            // Invalid credentials (Firebase v9+ returns this instead of user-not-found sometimes)
            if (code === "auth/invalid-credential") {
                try {
                    console.log("Invalid credentials, trying to create user...");
                    const newUserCred = await this.createUserWithEmailAndPassword(this.auth, email, password);
                    console.log("New user created:", newUserCred);
                    await this.finishLogin(email, true);
                    return;
                } catch (createErr) {
                    const createCode = createErr.code || "";
                    if (createCode === "auth/email-already-in-use") {
                        this.showError("password", "סיסמה שגויה");
                        this.passwordInput.focus();
                        this.setLoading(false);
                    } else {
                        console.error("Create user failed:", createErr);
                        this.showError("password", "לא ניתן ליצור משתמש חדש.");
                        this.setLoading(false);
                    }
                    return;
                }
            }

            // Fallback
            console.error("Login failed (unknown error):", err);
            this.showError("password", "שגיאה בהתחברות. אנא נסי שוב.");
            this.setLoading(false);
        }
    }

    async finishLogin(email, isNewUser = false) {
        try {
            console.log("=== FINISH LOGIN START ===");
            console.log("Email:", email);
            console.log("Is new user:", isNewUser);
            
            // Set current user in session
            await setCurrentUser(email);
            
            // Verify it was set
            const storedUser = sessionStorage.getItem("docArchiveCurrentUser");
            console.log("Stored user after setCurrentUser:", storedUser);
            
            // Set a flag to indicate successful login
            sessionStorage.setItem("loginSuccess", "true");
            console.log("loginSuccess flag set");

            // Check if user data exists in Firestore
            console.log("Loading user data from Firestore...");
            let userData = await loadUserDataFromFirestore(email);
            console.log("User data loaded:", userData);

            // If new user or no data exists, create initial data structure
            if (!userData) {
                console.log("Creating new user data in Firestore");
                userData = {
                    email: email,
                    docs: [],
                    createdAt: new Date().toISOString()
                };
                const saveResult = await saveUserDataToFirestore(email, userData);
                console.log("User data save result:", saveResult);
            }

            console.log("Calling showHarmonySuccess...");
            this.showHarmonySuccess();

            console.log("Setting timeout for redirect...");
            setTimeout(() => {
                console.log("=== REDIRECTING NOW ===");
                console.log("Current URL:", window.location.href);
                
                // Path from forms/eco-wellness/login.html to project/index.html
                const redirectPath = "../../index.html";
                console.log("Redirecting to:", redirectPath);
                
                window.location.replace(redirectPath);
            }, 1500);
        } catch (err) {
            console.error("=== ERROR IN FINISH LOGIN ===");
            console.error("Error details:", err);
            this.setLoading(false);
            alert("שגיאה בהתחברות. אנא נסי שוב.");
        }
    }

    showHarmonySuccess() {
        this.form.style.transform = 'scale(0.95)';
        this.form.style.opacity = '0';

        setTimeout(() => {
            this.form.style.display = 'none';
            document
                .querySelectorAll('.natural-social, .nurture-signup, .balance-divider')
                .forEach(el => el?.classList.add('hidden'));

            this.successMessage.classList.add('show');
        }, 300);
    }

    setupGoogleButton() {
        const googleBtn = document.querySelector(".earth-social");
        if (!googleBtn) return;

        googleBtn.addEventListener("click", async () => {
            try {
                this.setLoading(true);

                const result = await this.signInWithPopup(this.auth, this.googleProvider);
                const user = result.user;

                // Check if user data exists in Firestore
                let userData = await loadUserDataFromFirestore(user.email);

                // Create user data if doesn't exist
                if (!userData) {
                    userData = {
                        email: user.email,
                        displayName: user.displayName || "",
                        photoURL: user.photoURL || "",
                        docs: [],
                        createdAt: new Date().toISOString(),
                        loginMethod: "google"
                    };
                    await saveUserDataToFirestore(user.email, userData);
                }

                await setCurrentUser(user.email);

                this.showHarmonySuccess();
                setTimeout(() => {
                    console.log("Google login redirect to: ../../index.html");
                    window.location.replace("../../index.html");
                }, 1500);

            } catch (err) {
                console.error("Google Sign-In Error:", err);
                alert("שגיאה בהתחברות עם Google. נסי שוב.");
            } finally {
                this.setLoading(false);
            }
        });
    }
}

// Animation keyframes
if (!document.querySelector('#wellness-keyframes')) {
    const style = document.createElement('style');
    style.id = 'wellness-keyframes';
    style.textContent = `
        @keyframes gentleBreath {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.01); }
        }
    `;
    document.head.appendChild(style);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new EcoWellnessLoginForm();
});