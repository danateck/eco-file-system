// firebase-config.js
import { initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore, collection, addDoc, getDoc, getDocs, doc, query, where, updateDoc, setDoc, arrayUnion, onSnapshot   } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBPr4X2_8JYCgXzMlTcVB0EJLhup9CdyYw",
  authDomain: "login-page-echo-file.firebaseapp.com",
  databaseURL: "https://login-page-echo-file-default-rtdb.europe-west1.firebasedatabase.app", // ✅ ADD YOUR DATABASE URL HERE
  projectId: "login-page-echo-file",
  storageBucket: "login-page-echo-file.firebasestorage.app",
  messagingSenderId: "200723524735",
  appId: "1:200723524735:web:9eaed6ef10cbc2c406234a"
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
  useFetchStreams: false
});

// Make everything available globally for main.js
window.db = db;
window.fs = {
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  query,
  where,
  updateDoc,
  setDoc,
  arrayUnion, onSnapshot  
};

console.log("✅ Firestore connected with long polling");
console.log("📊 Database URL:", firebaseConfig.databaseURL);