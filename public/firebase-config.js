// firebase-config.js  (ES module)
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  // (you can import getFirestore instead; initializeFirestore is fine)
  collection, addDoc, getDoc, getDocs, doc, query, where,
  updateDoc, setDoc, arrayUnion, onSnapshot
} from "firebase/firestore";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "firebase/storage";

// === Your project config ===
const firebaseConfig = {
  apiKey: "AIzaSyBPr4X2_8JYCgXzMlTcVB0EJLhup9CdyYw",
  authDomain: "login-page-echo-file.firebaseapp.com",
  databaseURL: "https://login-page-echo-file-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "login-page-echo-file",
  // IMPORTANT: Firebase Storage bucket must be *.appspot.com
  storageBucket: "login-page-echo-file.appspot.com",
  messagingSenderId: "200723524735",
  appId: "1:200723524735:web:9eaed6ef10cbc2c406234a"
};

// === Init ===
const app = initializeApp(firebaseConfig);

// Force long-polling helps on some hosts / adblockers / GH Pages
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
  useFetchStreams: false
});

// Optional but useful if you upload files:
const storage = getStorage(app);

// === Expose globals exactly as your app expects ===
// Your code checks isFirebaseAvailable() -> needs window.db and window.fs.*
window.app = app;
window.db = db;

// Put Firestore + Storage helpers under one namespace (window.fs)
window.fs = {
  // Firestore
  collection, addDoc, getDoc, getDocs, doc, query, where,
  updateDoc, setDoc, arrayUnion, onSnapshot,
  // Storage
  ref, uploadBytes, getDownloadURL, deleteObject
};

// If you prefer easy access to storage instance too:
window.storage = storage;

console.log("✅ Firestore ready (long polling enabled)");
console.log("🗄️  Storage bucket:", firebaseConfig.storageBucket);
