// main.js - גרסה עם IndexedDB לשמירת קבצים גדולים בצורה יציבה



import { app, db, storage, fs } from "../../src/firebase-config.js"; // שנה את הנתיב אם צריך

// ✅ מחזיר תאימות לקוד הישן שלך
window.app = app;
window.db = db;
window.storage = storage;
window.fs = fs;

console.log("🔥 Firebase globals restored");





let stopWatching = null;
// Add this helper function at the top of your main.js
function getCurrentUserEmail() {
  const raw = sessionStorage.getItem("docArchiveCurrentUser") || "";
  return raw.trim().toLowerCase();
}

function isFirebaseAvailable() {
  return !!(window.db && window.fs && typeof window.fs.collection === "function");
}

// ============================================
// FIX 1: Load documents with user filtering
// ============================================
// v9 modular version
// v9 modular version
async function loadDocuments() {
  const me = getCurrentUserEmail();
  if (!me) return [];                 // not logged in yet
  if (!isFirebaseAvailable()) return []; // no cloud, nothing to load

  const col = window.fs.collection(window.db, "documents");
  const qOwned  = window.fs.query(col, window.fs.where("owner", "==", me));
  const qShared = window.fs.query(col, window.fs.where("sharedWith", "array-contains", me));

  const [ownedSnap, sharedSnap] = await Promise.all([
    window.fs.getDocs(qOwned),
    window.fs.getDocs(qShared),
  ]);

  const map = new Map();
  ownedSnap.forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
  sharedSnap.forEach(d => { if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() }); });

  return Array.from(map.values());
}


// ============================================
// FIX 2: Upload document with owner info
// ============================================
async function uploadDocument(file, metadata = {}) {
  const raw = getCurrentUserEmail();
  const currentUser = raw ? normalizeEmail(raw) : null;
  if (!currentUser) throw new Error("User not logged in");

  // Generate our doc ID so UI and Firestore use the same one
  const newId = crypto.randomUUID();

  let downloadURL = null;
  try {
    if (window.storage) {
      const storageRef = window.fs.ref(window.storage, `documents/${currentUser}/${newId}_${file.name}`);
      const snap = await window.fs.uploadBytes(storageRef, file);
      downloadURL = await window.fs.getDownloadURL(snap.ref);
    }
  } catch (e) {
    console.warn("Storage upload skipped/failed:", e);
  }

  const docRef = window.fs.doc(window.db, "documents", newId);
  const docData = {
    ...metadata,
    owner: currentUser,
    downloadURL: downloadURL || null,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    uploadedAt: Date.now(),
    sharedWith: Array.isArray(metadata.sharedWith) ? metadata.sharedWith : [],
    deletedAt: null,
    deletedBy: null
  };

  await window.fs.setDoc(docRef, docData, { merge: true });
  return { id: newId, ...docData };
}




function watchMyDocs() {
  if (!isFirebaseAvailable()) return () => {};
  if (stopWatching) { try { stopWatching(); } catch (_) {} }

  const me = getCurrentUserEmail();
  if (!me) return () => {};

  const col = window.fs.collection(window.db, "documents");
  const qOwned  = window.fs.query(col, window.fs.where("owner", "==", me));
  const qShared = window.fs.query(col, window.fs.where("sharedWith", "array-contains", me));

  const applySnap = (snap) => {
    // Merge into global allDocsData (owned + shared)
    const byId = new Map((allDocsData || []).map(d => [d.id, d]));
    snap.forEach(doc => {
      const data = { id: doc.id, ...doc.data() };
      byId.set(doc.id, data);
    });
    allDocsData = Array.from(byId.values());
    // Make sure your app-level cache also updated:
    if (typeof setUserDocs === "function" && typeof allUsersData !== "undefined" && typeof userNow !== "undefined") {
      setUserDocs(userNow, allDocsData, allUsersData);
    }
    // Re-render the current view
    if (typeof categoryTitle !== "undefined" && categoryTitle?.textContent) {
      const current = categoryTitle.textContent;
      if (current === "אחסון משותף" && typeof openSharedView === "function") {
        openSharedView();
      } else if (current === "סל מחזור" && typeof openRecycleView === "function") {
        openRecycleView();
      } else if (typeof openCategoryView === "function") {
        openCategoryView(current);
      } else if (typeof renderHome === "function") {
        renderHome();
      }
    } else if (typeof renderHome === "function") {
      renderHome();
    }
  };

  const unsubOwned  = window.fs.onSnapshot(qOwned,  (snap) => applySnap(snap));
  const unsubShared = window.fs.onSnapshot(qShared, (snap) => applySnap(snap));

  stopWatching = () => { unsubOwned(); unsubShared(); };
  return stopWatching;
}




async function bootFromCloud() {
  const me = getCurrentUserEmail();
  if (!me || !isFirebaseAvailable()) return;

  try {
    if (typeof showLoading === "function") showLoading("טוען מסמכים מהענן...");
    const docs = await loadDocuments();
    // Save into your app globals (these exist in your project)
    allDocsData = docs || [];
    if (typeof setUserDocs === "function" && typeof allUsersData !== "undefined" && typeof userNow !== "undefined") {
      setUserDocs(userNow, allDocsData, allUsersData);
    }
    if (typeof renderHome === "function") renderHome();
  } finally {
    if (typeof hideLoading === "function") hideLoading();
  }

  // start live updates
  watchMyDocs();
}




// ============================================
// FIX 3: Load shared folders with user filtering
// ============================================
async function loadSharedFolders() {
  const currentUser = getCurrentUserEmail();
  if (!currentUser) {
    console.error("No user logged in");
    return [];
  }

  try {
    const foldersCol = window.db.collection("sharedFolders");
    
    // Query folders where:
    // - owner matches current user, OR
    // - members array contains current user
    const ownedSnapshot = await foldersCol
      .where("owner", "==", currentUser)
      .get();
    
    const memberSnapshot = await foldersCol
      .where("members", "array-contains", currentUser)
      .get();

    const folders = [];
    
    // Add owned folders
    ownedSnapshot.forEach(doc => {
      folders.push({ id: doc.id, ...doc.data() });
    });
    
    // Add folders where user is a member (avoid duplicates)
    memberSnapshot.forEach(doc => {
      if (!folders.find(f => f.id === doc.id)) {
        folders.push({ id: doc.id, ...doc.data() });
      }
    });

    return folders;
  } catch (error) {
    console.error("Error loading shared folders:", error);
    return [];
  }
}

// ============================================
// FIX 4: Create shared folder with owner info
// ============================================
async function createSharedFolder(folderName, invitedEmails = []) {
  const currentUser = getCurrentUserEmail();
  if (!currentUser) {
    throw new Error("User not logged in");
  }

  try {
    const folderData = {
      name: folderName,
      owner: currentUser,  // CRITICAL: Tag with owner
      members: [currentUser, ...invitedEmails],  // Include owner in members
      pendingInvites: invitedEmails.map(email => ({
        email: email,
        invitedBy: currentUser,
        invitedAt: new Date().toISOString(),
        status: "pending"
      })),
      createdAt: new Date().toISOString(),
      createdBy: currentUser
    };

    const folderRef = await window.db.collection("sharedFolders").add(folderData);
    
    return { id: folderRef.id, ...folderData };
  } catch (error) {
    console.error("Error creating shared folder:", error);
    throw error;
  }
}

// ============================================
// FIX 5: Share document with proper ownership check
// ============================================
async function shareDocument(docId, recipientEmails) {
  const currentUser = getCurrentUserEmail();
  if (!currentUser) {
    throw new Error("User not logged in");
  }

  try {
    const docRef = window.db.collection("documents").doc(docId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
      throw new Error("Document not found");
    }

    const docData = docSnap.data();
    
    // Check if current user is the owner
    if (docData.owner !== currentUser) {
      throw new Error("Only the owner can share this document");
    }

    // Add recipients to sharedWith array
    const currentSharedWith = docData.sharedWith || [];
    const newSharedWith = [...new Set([...currentSharedWith, ...recipientEmails])];

    await docRef.update({
      sharedWith: newSharedWith,
      lastModified: new Date().toISOString(),
      lastModifiedBy: currentUser
    });

    return { success: true };
  } catch (error) {
    console.error("Error sharing document:", error);
    throw error;
  }
}

// ============================================
// FIX 6: Get documents for specific category with user filter
// ============================================
async function getDocumentsByCategory(category) {
  const currentUser = getCurrentUserEmail();
  if (!currentUser) {
    return [];
  }

  try {
    const docsCol = window.db.collection("documents");
    
    // Get owned documents in this category
    const ownedSnapshot = await docsCol
      .where("owner", "==", currentUser)
      .where("category", "==", category)
      .where("deletedAt", "==", null)
      .get();
    
    // Get shared documents in this category
    const sharedSnapshot = await docsCol
      .where("sharedWith", "array-contains", currentUser)
      .where("category", "==", category)
      .where("deletedAt", "==", null)
      .get();

    const docs = [];
    
    ownedSnapshot.forEach(doc => {
      docs.push({ id: doc.id, ...doc.data() });
    });
    
    sharedSnapshot.forEach(doc => {
      if (!docs.find(d => d.id === doc.id)) {
        docs.push({ id: doc.id, ...doc.data() });
      }
    });

    return docs;
  } catch (error) {
    console.error("Error getting documents by category:", error);
    return [];
  }
}

// ============================================
// EXPORT ALL FUNCTIONS
// ============================================
// Make these available globally or export them
window.AppFunctions = {
  loadDocuments,
  uploadDocument,
  loadSharedFolders,
  createSharedFolder,
  shareDocument,
  getDocumentsByCategory,
  getCurrentUserEmail
};

console.log("✅ User-scoped Firebase functions loaded");







document.getElementById("closeMenuBtn")?.addEventListener("click", () => {
  // change '.sidebar' to your actual drawer element selector if different
  document.querySelector(".sidebar")?.classList.remove("open");
});



const sidebar = document.querySelector(".sidebar");
const openBtn = document.getElementById("openMenuBtn");  // your button that opens the menu
const closeBtn = document.getElementById("closeMenuBtn"); // the ✕ button inside the menu

openBtn?.addEventListener("click", () => {
  sidebar.classList.add("open");
});

closeBtn?.addEventListener("click", () => {
  sidebar.classList.remove("open");
});


document.getElementById("premiumBtn")?.addEventListener("click", () => {
  document.getElementById("premiumPanel")?.classList.remove("hidden");
});





/*************************
 * 0. IndexedDB helpers  *
 *************************/

// נפתח/ניצור DB בשם "docArchiveDB" עם טבלה "files"
// בקי לכל קובץ: id (המזהה של הדוקומנט)
// value שמור זה ה-base64 (dataURL)

// בדיקה אם Firebase זמין
window.isFirebaseAvailable = function() {
  try {
    // check Firestore connection objects exist
    return !!(window.db && window.fs && typeof window.fs.getDoc === "function" && navigator.onLine);
  } catch (e) {
    console.error("Error checking Firebase:", e);
    return false;
  }
};





async function uploadDocumentWithStorage(file, metadata = {}, forcedId=null) {
  const currentUser = normalizeEmail(getCurrentUserEmail());
  if (!currentUser) throw new Error("User not logged in");

  const id = forcedId || crypto.randomUUID();
  let downloadURL = null;

  // (optional) upload bytes to Storage
  if (window.storage && isFirebaseAvailable()) {
    const storageRef = window.fs.ref(window.storage, `documents/${currentUser}/${id}_${file.name}`);
    const snap = await window.fs.uploadBytes(storageRef, file);
    downloadURL = await window.fs.getDownloadURL(snap.ref);
  }

  // write metadata to Firestore
  const docRef = window.fs.doc(window.db, "documents", id);
  const docData = {
    ...metadata,
    owner: currentUser,
    sharedWith: Array.isArray(metadata.sharedWith) ? metadata.sharedWith : [],
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    uploadedAt: Date.now(),
    downloadURL: downloadURL || null,
    deletedAt: null,
    deletedBy: null,
  };
  await window.fs.setDoc(docRef, docData, { merge: true });
  return { id, ...docData };
}



// 3. Updated file upload handler (replace in your DOMContentLoaded)
// Replace your existing fileInput.addEventListener("change", ...) with this:

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) {
    showNotification("❌ ×œ× × ×'×—×¨ ק×•×'×¥", true);
    return;
  }

  try {
    const fileName = file.name.trim();

    // Check for duplicates
    const alreadyExists = allDocsData.some(doc => {
      return (
        doc.originalFileName === fileName &&
        doc._trashed !== true
      );
    });
    
    if (alreadyExists) {
      showNotification("הקובץ הזה כבר קיים בארכיון שלך", true);
      fileInput.value = "";
      return;
    }

    // Guess category
    let guessedCategory = guessCategoryForFileNameOnly(file.name);
    if (!guessedCategory || guessedCategory === "אחר") {
      const manual = prompt(
        'לא זיהיתי אוטומטית את סוג המסמך.\nלאיזה תיקייה לשמור?\nאפשרויות: ' +
        CATEGORIES.join(", "),
        "רפואה"
      );
      if (manual && manual.trim() !== "") {
        guessedCategory = manual.trim();
      } else {
        guessedCategory = "אחר";
      }
    }

    // Warranty details if needed
    let warrantyStart = null;
    let warrantyExpiresAt = null;
    let autoDeleteAfter = null;

    if (guessedCategory === "אחריות") {
      let extracted = {
        warrantyStart: null,
        warrantyExpiresAt: null,
        autoDeleteAfter: null,
      };

      if (file.type === "application/pdf") {
        const ocrText = await extractTextFromPdfWithOcr(file);
        const dataFromText = extractWarrantyFromText(ocrText);
        extracted = { ...extracted, ...dataFromText };
      }

      if (file.type.startsWith("image/") && window.Tesseract) {
        const { data } = await window.Tesseract.recognize(file, "heb+eng", {
          tessedit_pageseg_mode: 6,
        });
        const imgText = data?.text || "";
        const dataFromText = extractWarrantyFromText(imgText);
        extracted = { ...extracted, ...dataFromText };
      }

      if (!extracted.warrantyStart && !extracted.warrantyExpiresAt) {
        const buf = await file.arrayBuffer().catch(() => null);
        if (buf) {
          const txt = new TextDecoder("utf-8").decode(buf);
          const dataFromText = extractWarrantyFromText(txt);
          extracted = { ...extracted, ...dataFromText };
        }
      }

      if (!extracted.warrantyStart && !extracted.warrantyExpiresAt) {
        const manualData = fallbackAskWarrantyDetails();
        if (manualData.warrantyStart) {
          extracted.warrantyStart = manualData.warrantyStart;
        }
        if (manualData.warrantyExpiresAt) {
          extracted.warrantyExpiresAt = manualData.warrantyExpiresAt;
        }
        if (manualData.autoDeleteAfter) {
          extracted.autoDeleteAfter = manualData.autoDeleteAfter;
        }
      }

      warrantyStart     = extracted.warrantyStart     || null;
      warrantyExpiresAt = extracted.warrantyExpiresAt || null;
      autoDeleteAfter   = extracted.autoDeleteAfter   || null;
    }

    // Read file as base64 for local storage
    const fileDataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const newId = crypto.randomUUID();

    // Save to IndexedDB (local cache)
    await saveFileToDB(newId, fileDataBase64);

    // Upload to Firebase Storage + Firestore
    let cloudDoc = null;
    if (isFirebaseAvailable()) {
      try {
        cloudDoc = await uploadDocumentWithStorage(file, {
          title: fileName,
          category: guessedCategory,
          year: new Date().getFullYear().toString(),
          org: "",
          recipient: [],
          warrantyStart,
          warrantyExpiresAt,
          autoDeleteAfter
        });
        
        // Use the cloud doc data
        if (cloudDoc && cloudDoc.id) {
          // Update local doc with cloud info
          const newDoc = {
            id: newId,
            ...cloudDoc,
            title: fileName,
            originalFileName: fileName,
            mimeType: file.type,
            hasFile: true
          };
          
          allDocsData.push(newDoc);
          setUserDocs(userNow, allDocsData, allUsersData);
          
          showNotification(`✅ הקובץ נוסף לתיקייה "${guessedCategory}" ושמור בענן`);
        }
        
      } catch (e) {
        console.error("Cloud upload failed, saving locally only:", e);
        
        // Fallback: save locally only
        const newDoc = {
          id: newId,
          title: fileName,
          originalFileName: fileName,
          category: guessedCategory,
          uploadedAt: new Date().toISOString().split("T")[0],
          year: new Date().getFullYear().toString(),
          org: "",
          recipient: [],
          sharedWith: [],
          warrantyStart,
          warrantyExpiresAt,
          autoDeleteAfter,
          mimeType: file.type,
          hasFile: true,
          downloadURL: null
        };
        
        allDocsData.push(newDoc);
        setUserDocs(userNow, allDocsData, allUsersData);
        
        showNotification(`⚠️ נשמר במכשיר בלבד (ללא סינכרון ענן)`, true);
      }
    } else {
      // No Firebase - local only
      const newDoc = {
        id: newId,
        title: fileName,
        originalFileName: fileName,
        category: guessedCategory,
        uploadedAt: new Date().toISOString().split("T")[0],
        year: new Date().getFullYear().toString(),
        org: "",
        recipient: [],
        sharedWith: [],
        warrantyStart,
        warrantyExpiresAt,
        autoDeleteAfter,
        mimeType: file.type,
        hasFile: true,
        downloadURL: null
      };
      
      allDocsData.push(newDoc);
      setUserDocs(userNow, allDocsData, allUsersData);
      
      showNotification(`✅ הקובץ נוסף לתיקייה "${guessedCategory}"`);
    }

    // Refresh UI
    const currentCat = categoryTitle.textContent;
    if (currentCat === "אחסון משותף") {
      openSharedView();
    } else if (currentCat === "סל מחזור") {
      openRecycleView();
    } else if (!homeView.classList.contains("hidden")) {
      renderHome();
    } else {
      openCategoryView(currentCat);
    }

    fileInput.value = "";

  } catch (err) {
    console.error("שגיאה בהעלאה:", err);
    showNotification("הייתה בעיה בהעלאה. נסה שוב או קובץ אחר.", true);
    hideLoading();
  }
});



// 3. Updated file upload handler (replace in your DOMContentLoaded)
// Replace your existing fileInput.addEventListener("change", ...) with this:




function handleLogout() {
  // Clear session
  sessionStorage.removeItem(CURRENT_USER_KEY);
  
  // Stop any active listeners
  if (stopWatching) stopWatching();
  if (window._stopMembersWatch) window._stopMembersWatch();
  if (window._stopSharedDocsWatch) window._stopSharedDocsWatch();
  
  // Clear local data
  allDocsData = [];
  
  console.log("🚪 User logged out");
}






async function syncAllLocalDocsToCloud() {
  if (!isFirebaseAvailable()) {
    showNotification("Firebase לא זמין", true);
    return;
  }
  
  showLoading("מסנכרן מסמכים לענן...");
  
  let synced = 0;
  let failed = 0;
  
  for (const doc of allDocsData) {
    if (doc._trashed) continue;
    
    // Check if already has downloadURL
    if (doc.downloadURL) {
      synced++;
      continue;
    }
    
    // Try to get file from IndexedDB
    const dataUrl = await loadFileFromDB(doc.id).catch(() => null);
    if (!dataUrl) {
      console.warn(`No file data for doc ${doc.id}`);
      failed++;
      continue;
    }
    
    // Convert dataURL to Blob
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      
      // Create File object
      const file = new File(
        [blob], 
        doc.originalFileName || doc.fileName || "file", 
        { type: doc.mimeType || "application/octet-stream" }
      );
      
      // Upload to Storage
      const currentUser = normalizeEmail(getCurrentUserEmail() || userNow);
      const storageRef = window.fs.ref(
        window.storage, 
        `documents/${currentUser}/${doc.id}_${file.name}`
      );
      
      const snapshot = await window.fs.uploadBytes(storageRef, file);
      const downloadURL = await window.fs.getDownloadURL(snapshot.ref);
      
      // Update Firestore
      const docRef = window.fs.doc(window.db, "documents", doc.id);
      await window.fs.updateDoc(docRef, { downloadURL });
      
      // Update local
      doc.downloadURL = downloadURL;
      synced++;
      
      console.log(`✅ Synced doc ${doc.id}`);
      
    } catch (e) {
      console.error(`❌ Failed to sync doc ${doc.id}:`, e);
      failed++;
    }
  }
  
  setUserDocs(userNow, allDocsData, allUsersData);
  hideLoading();
  
  showNotification(`✅ ס×•× ×›×¨× ×• ${synced} ×ž×¡×ž×›×™×${failed > 0 ? `, ${failed} × ×›×©×œ×•` : ''}`);
}

// Make functions globally accessible
window.syncAllLocalDocsToCloud = syncAllLocalDocsToCloud;
window.handleLogout = handleLogout;

console.log("✅ Enhanced Firebase persistence loaded");









function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("docArchiveDB", 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

// שמירת קובץ (base64) ב-IndexedDB
async function saveFileToDB(docId, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["files"], "readwrite");
    const store = tx.objectStore("files");
    store.put({ id: docId, dataUrl });
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// שליפה של קובץ מה-DB לפי docId
async function loadFileFromDB(docId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["files"], "readonly");
    const store = tx.objectStore("files");
    const req = store.get(docId);
    req.onsuccess = () => {
      if (req.result) resolve(req.result.dataUrl);
      else resolve(null);
    };
    req.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

// מחיקה של קובץ מה-DB (אם מוחקים לצמיתות)
async function deleteFileFromDB(docId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["files"], "readwrite");
    const store = tx.objectStore("files");
    store.delete(docId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// סנכרון משתמש חדש ל-Firestore

// סנכרון משתמש חדש ל-Firestore
async function syncUserToFirestore(email, password = "") {
  console.log("🔄 מנסה לסנכרן משתמש:", email);
  
  // בדיקה פשוטה יותר
  if (!window.db || !window.fs) {
    console.warn("❌ Firebase לא זמין - חסר DB או FS");
    return false;
  }
  
  if (!navigator.onLine) {
    console.warn("❌ אין חיבור לאינטרנט");
    return false;
  }
  
  try {
    const key = email.trim().toLowerCase();
    console.log("🔑 Creating user document for:", key);
    
    const userRef = window.fs.doc(window.db, "users", key);
    
    await window.fs.setDoc(userRef, {
      email: key,
      password: password,
      sharedFolders: {},
      createdAt: Date.now()
    }, { merge: true });
    
    console.log("✅ משתמש סונכרן ל-Firestore:", key);
    return true;
  } catch (e) {
    console.error("❌ שגיאה בסנכרון משתמש ל-Firestore:", e);
    console.error("Error details:", e.message, e.code);
    return false;
  }
}

async function checkUserExistsInFirestore(email) {
  const key = email.trim().toLowerCase();
  console.log("בודק משתמש ב-Firestore:", key);
  
  // אם Firebase לא זמין, בדוק ב-localStorage
  if (!isFirebaseAvailable()) {
    console.warn("Firebase לא זמין, בודק ב-localStorage");
    const allUsers = loadAllUsersDataFromStorage();
    for (const [username, userData] of Object.entries(allUsers)) {
      const userEmail = (userData.email || username).toLowerCase();
      if (userEmail === key) {
        console.log("✅ משתמש נמצא ב-localStorage:", username);
        return true;
      }
    }
    console.log("❌ משתמש לא נמצא ב-localStorage");
    return false;
  }
  
  // בדיקה ב-Firestore
  try {
    const userRef = window.fs.doc(window.db, "users", key);
    const docSnap = await window.fs.getDoc(userRef);
    
    if (docSnap.exists()) {
      console.log("✅ משתמש נמצא ב-Firestore:", key);
      return true;
    }
    
    console.log("❌ משתמש לא נמצא ב-Firestore");
    return false;
  } catch (e) {
    console.error("שגיאה בבדיקת משתמש ב-Firestore:", e);
    
    // Fallback ל-localStorage במקרה של שגיאה
    console.warn("עובר ל-localStorage בגלל שגיאה");
    const allUsers = loadAllUsersDataFromStorage();
    for (const [username, userData] of Object.entries(allUsers)) {
      const userEmail = (userData.email || username).toLowerCase();
      if (userEmail === key) {
        console.log("✅ משתמש נמצא ב-localStorage (fallback):", username);
        return true;
      }
    }
    return false;
  }
}



window.syncAllUsers = async function() {
  if (!isFirebaseAvailable()) {
    console.warn("❌ Firebase unavailable");
    return;
  }
  const allUsers = loadAllUsersDataFromStorage();
  let successCount = 0;
  for (const [username, userData] of Object.entries(allUsers)) {
    const email = userData.email || username;
    const password = userData.password || "";
    const result = await syncUserToFirestore(email, password);
    if (result) successCount++;
  }
  console.log(`✅ Synced ${successCount} users to Firestore`);
};



// הוסף פונקציה זו איפשהו בקוד
async function syncAllLocalUsersToFirestore() {
  if (!isFirebaseAvailable()) {
    //showNotification("Firebase לא זמין", true);
    return;
  }
  
  const allUsers = loadAllUsersDataFromStorage();
  let count = 0;
  
  for (const [username, userData] of Object.entries(allUsers)) {
    const email = userData.email || username;
    const success = await syncUserToFirestore(email, userData.password || "");
    if (success) count++;
  }
  
  showNotification(`✅ ${count} משתמשים סונכרנו ל-Firestore`);
}

 syncAllLocalUsersToFirestore();



async function sendShareInviteToFirestore(fromEmail, toEmail, folderId, folderName) {
  // נורמליזציה של אימיילים אחידה
  fromEmail = normalizeEmail(fromEmail);
  toEmail   = normalizeEmail(toEmail);
  
  console.log("📤 Sending invite from", fromEmail, "to", toEmail);
  
  // אם Firebase לא זמין, שמור ב-localStorage
  if (!isFirebaseAvailable()) {
    console.warn("Firebase לא זמין, שומר הזמנה ב-localStorage");
    try {
      const allUsers = loadAllUsersDataFromStorage();
      const targetUser = findUsernameByEmail(allUsers, toEmail);
      
      if (!targetUser) {
        console.error("משתמש היעד לא נמצא:", toEmail);
        return false;
      }
      
      ensureUserSharedFields(allUsers, targetUser);
      allUsers[targetUser].incomingShareRequests.push({
        folderId,
        folderName,
        fromEmail: fromEmail,
        toEmail: toEmail,
        status: "pending",
        createdAt: Date.now()
      });
      
      saveAllUsersDataToStorage(allUsers);
      console.log("✅ הזמנה נשמרה ב-localStorage");
      return true;
    } catch (e) {
      console.error("שגיאה בשמירה ב-localStorage:", e);
      return false;
    }
  }
  
  // אם Firebase זמין, נסה לשלוח
  try {
    const inviteRef = window.fs.collection(window.db, "shareInvites");
    await window.fs.addDoc(inviteRef, {
      folderId,
      folderName,
      fromEmail: fromEmail,
      toEmail: toEmail,
      status: "pending",
      createdAt: Date.now()
    });
    console.log("✅ הזמנה נשלחה ל-Firestore");
    return true;
  } catch (e) {
    console.error("שגיאה בשליחת הזמנה ל-Firestore, עובר ל-localStorage:", e);
    
    // Fallback ל-localStorage (בלי רקורסיה!)
    try {
      const allUsers = loadAllUsersDataFromStorage();
      const targetUser = findUsernameByEmail(allUsers, toEmail);
      
      if (!targetUser) return false;
      
      ensureUserSharedFields(allUsers, targetUser);
      allUsers[targetUser].incomingShareRequests.push({
        folderId,
        folderName,
        fromEmail: fromEmail,
        toEmail: toEmail,
        status: "pending",
        createdAt: Date.now()
      });
      
      saveAllUsersDataToStorage(allUsers);
      return true;
    } catch (localErr) {
      console.error("גם localStorage נכשל:", localErr);
      return false;
    }
  }
}




// קבלת הזמנות ממתינות למשתמש (Firestore)
// קבלת הזמנות ממתינות למשתמש (Firestore)
// קבלת הזמנות ממתינות למשתמש (Firestore)
async function getPendingInvitesFromFirestore(userEmail) {
  const allUsers = loadAllUsersDataFromStorage();
  const currentUserKey = getCurrentUser(); // מה-LocalStorage
  const currentUserObj = allUsers[currentUserKey] || {};

  // תמיד אימייל מנורמל של המשתמש המחובר, אלא אם הועבר userEmail מפורש
  const myEmail = normalizeEmail(
    userEmail || currentUserObj.email || currentUserKey || ""
  );

  if (!isFirebaseAvailable()) {
    console.warn("Firebase לא זמין, בודק ב-localStorage");
    const me = allUsers[currentUserKey];
    return (me?.incomingShareRequests || []).filter(r => r.status === "pending");
  }

  try {
    const invitesRef = window.fs.collection(window.db, "shareInvites");
    const q = window.fs.query(
      invitesRef,
      window.fs.where("toEmail", "==", myEmail),
      window.fs.where("status", "==", "pending")
    );
    const snap = await window.fs.getDocs(q);
    const invites = [];
    snap.forEach(d => invites.push({ id: d.id, ...d.data() }));
    console.log("📩 Pending invites for", myEmail, "=>", invites.length, invites);
    return invites;
  } catch (e) {
    console.error("שגיאה בטעינת הזמנות מ-Firestore, עובר ל-localStorage:", e);
    const me = allUsers[currentUserKey];
    return (me?.incomingShareRequests || []).filter(r => r.status === "pending");
  }
}


// At the very top of main.

// Later, just reassign it — never redeclare
if (stopWatching) stopWatching();
stopWatching = watchPendingInvites(async (invites) => {
  console.log("🔔 Real-time update:", invites.length, "invites");
  paintPending(invites);
});


function watchPendingInvites(onChange) {
  const allUsers = loadAllUsersDataFromStorage();
  const currentUserKey = getCurrentUser();
  const email = normalizeEmail((allUsers[currentUserKey]?.email) || currentUserKey || "");
  if (!isFirebaseAvailable() || !email) return () => {};

  const invitesRef = window.fs.collection(window.db, "shareInvites");
  const q = window.fs.query(
    invitesRef,
    window.fs.where("toEmail", "==", email),
    window.fs.where("status", "==", "pending")
  );
  const unsub = window.fs.onSnapshot(q, (snap) => {
    const invites = [];
    snap.forEach(d => invites.push({ id: d.id, ...d.data() }));
    onChange(invites);
  }, (err) => {
    console.error("onSnapshot error", err);
  });
  return unsub;
}


// עדכון סטטוס הזמנה (Firestore)
async function updateInviteStatus(inviteId, newStatus) {
  try {
    const inviteRef = window.fs.doc(window.db, "shareInvites", inviteId);
    await window.fs.updateDoc(inviteRef, { status: newStatus, updatedAt: Date.now() });
    return true;
  } catch (e) {
    console.error("שגיאה בעדכון הזמנה:", e);
    return false;
  }
}


// הוספת חבר לתיקייה משותפת (Firestore)
// הוספת חבר לתיקייה משותפת (Firestore) - גרסה עמידה
async function addMemberToSharedFolder(folderId, memberEmail, folderName, ownerEmail) {
  try {
    const key = memberEmail.trim().toLowerCase();
    const ownerKey = ownerEmail.trim().toLowerCase();

    const userRef  = window.fs.doc(window.db, "users", key);
    const ownerRef = window.fs.doc(window.db, "users", ownerKey);

    // 1) ודא שקיימים מסמכי המשתמשים (יוצר אם חסר)
    await window.fs.setDoc(userRef,  { email: key },   { merge: true });
    await window.fs.setDoc(ownerRef, { email: ownerKey }, { merge: true });

    // 2) ודא שקיים אובייקט התיקייה אצל שני הצדדים
    const baseFolderObj = {
      name: folderName,
      owner: ownerKey,
      // נתחיל במערך ריק; נמלא עם arrayUnion בהמשך
      members: []
    };

    await window.fs.setDoc(
      userRef,
      { [`sharedFolders.${folderId}`]: baseFolderObj },
      { merge: true }
    );

    await window.fs.setDoc(
      ownerRef,
      { [`sharedFolders.${folderId}`]: baseFolderObj },
      { merge: true }
    );

    // 3) הוסף את החבר החדש למערך החברים אצל שני הצדדים (יוצר את השדה אם אינו קיים)
    await window.fs.updateDoc(userRef, {
      [`sharedFolders.${folderId}.members`]: window.fs.arrayUnion(key, ownerKey)
    });

    await window.fs.updateDoc(ownerRef, {
      [`sharedFolders.${folderId}.members`]: window.fs.arrayUnion(key, ownerKey)
    });

    return true;
  } catch (e) {
    console.error("שגיאה בהוספת חבר:", e);
    return false;
  }
}

// --- Fetch and watch members for a shared folder from Firestore (owner's doc) ---
async function fetchFolderMembersFromOwner(ownerEmail, folderId) {
  if (!isFirebaseAvailable()) return [];
  const ownerKey = normalizeEmail(ownerEmail || "");
  const ownerRef = window.fs.doc(window.db, "users", ownerKey);
  const snap = await window.fs.getDoc(ownerRef);
  if (!snap.exists()) return [];
  const data = snap.data() || {};
  const members = (data.sharedFolders && data.sharedFolders[folderId] && data.sharedFolders[folderId].members) || [];
  return Array.isArray(members) ? members : [];
}

// --- Members: live watch on owner's doc
function watchFolderMembersFromOwner(ownerEmail, folderId, onChange) {
  if (!isFirebaseAvailable()) return () => {};
  const ownerKey = normalizeEmail(ownerEmail || "");
  const ownerRef = window.fs.doc(window.db, "users", ownerKey);
  const unsub = window.fs.onSnapshot(ownerRef, (snap) => {
    const data = snap.data() || {};
    const members = (data.sharedFolders && data.sharedFolders[folderId] && data.sharedFolders[folderId].members) || [];
    onChange(Array.isArray(members) ? members : []);
  }, (err) => console.error("watchFolderMembersFromOwner error", err));
  return unsub;
}


// --- Shared docs: write one record per doc in a folder
async function upsertSharedDocRecord(docObj, folderId) {
  if (!isFirebaseAvailable()) {
    console.warn("Firebase not available, cannot sync shared doc");
    return false;
  }

  try {
    // Get current user safely
    const currentUser = getCurrentUser() || "defaultUser";
    const allUsers = loadAllUsersDataFromStorage();
    const ownerEmail = (allUsers[currentUser]?.email || currentUser).toLowerCase();
    const recId = `${docObj.id}_${ownerEmail}`;

    console.log("📤 Syncing shared doc to Firestore:", {
      recId,
      folderId,
      ownerEmail,
      fileName: docObj.title || docObj.fileName
    });

    const ref = window.fs.doc(window.db, "sharedDocs", recId);
    await window.fs.setDoc(ref, {
      folderId,
      ownerEmail,
      id: docObj.id,
      title: docObj.title || docObj.fileName || docObj.name || "מסמך",
      fileName: docObj.fileName || docObj.title || docObj.name || "מסמך",
      category: docObj.category || [],
      uploadedAt: docObj.uploadedAt || Date.now(),
      warrantyStart: docObj.warrantyStart || null,
      warrantyExpiresAt: docObj.warrantyExpiresAt || null,
      org: docObj.org || "",
      year: docObj.year || "",
      recipient: docObj.recipient || [],
      lastUpdated: Date.now()
    }, { merge: true });
    
    console.log("✅ Successfully synced shared doc to Firestore");
    return true;
  } catch (e) {
    console.error("❌ Error syncing shared doc to Firestore:", e);
    return false;
  }
}
// --- Shared docs: fetch once by folder
async function fetchSharedFolderDocsFromFirestore(folderId) {
  if (!isFirebaseAvailable()) return [];
  const col = window.fs.collection(window.db, "sharedDocs");
  const q   = window.fs.query(col, window.fs.where("folderId", "==", folderId));
  const snap = await window.fs.getDocs(q);
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data(), _ownerEmail: d.data().ownerEmail }));
  return out;
}

// --- Shared docs: live watch by folder
function watchSharedFolderDocs(folderId, onChange) {
  if (!isFirebaseAvailable()) return () => {};
  const col = window.fs.collection(window.db, "sharedDocs");
  const q   = window.fs.query(col, window.fs.where("folderId", "==", folderId));
  const unsub = window.fs.onSnapshot(q, (snap) => {
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data(), _ownerEmail: d.data().ownerEmail }));
    onChange(out);
  }, (err) => console.error("watchSharedFolderDocs error", err));
  return unsub;
}

// --- (Optional) sync my local docs that are in a shared folder -> Firestore
// --- Shared docs: mirror my locally-tagged docs into Firestore (self-contained)
async function syncMySharedDocsToFirestore() {
  if (!isFirebaseAvailable()) return;

  // pull fresh data from storage + current user safely (no outer-scope vars)
  const meKey = (getCurrentUser && getCurrentUser()) || "defaultUser";
  const allUsers = (typeof loadAllUsersDataFromStorage === "function")
    ? loadAllUsersDataFromStorage()
    : {};
  const me = allUsers[meKey] || {};
  const myDocs = Array.isArray(me.docs) ? me.docs : [];

  for (const d of myDocs) {
    if (!d._trashed && d.sharedFolderId) {
      await upsertSharedDocRecord(d, d.sharedFolderId);
    }
  }
}







async function migrateLocalDocsToDocuments() {
  if (!isFirebaseAvailable()) { console.warn("Firebase unavailable"); return; }
  const me = normalizeEmail(getCurrentUserEmail());
  let pushed = 0;
  for (const d of allDocsData) {
    if (!d || d._trashed) continue;
    const ref = window.fs.doc(window.db, "documents", d.id || crypto.randomUUID());
    await window.fs.setDoc(ref, { ...d, owner: me }, { merge: true });
    pushed++;
  }
  console.log("Migrated", pushed, "docs");
}


window.isFirebaseAvailable = function () {
  try { return !!(window.db && window.fs && typeof window.fs.getDoc === "function"); }
  catch { return false; }
};









/*************************
 * 1. קטגוריות / מילות מפתח
 *************************/

const CATEGORY_KEYWORDS = {
  "כלכלה": [
    "חשבון","חשבונית","חשבונית מס","חשבוניתמס","חשבוניתמס קבלה","קבלה","קבלות",
    "ארנונה","ארנונה מגורים","ארנונה לבית","סכום לתשלום","סכום לתשלום מיידי",
    "בנק","בנק הפועלים","בנק לאומי","בנק דיסקונט","יתרה","מאזן","עובר ושב","עו\"ש",
    "אשראי","כרטיס אשראי","פירוט אשראי","פירוט כרטיס","חיוב אשראי",
    "תשלום","תשלומים","הוראת קבע","הוראתקבע","חיוב חודשי","חיוב חודשי לכרטיס",
    "משכנתא","הלוואה","הלוואות","יתרת הלוואה","פירעון","ריבית","ריביות",
    "משכורת","משכורת חודשית","משכורת נטו","שכר","שכר עבודה","שכר חודשי","שכר נטו",
    "תלוש","תלוש שכר","תלושי שכר","תלושמשכורת","תלושמשכורת חודשי",
    "ביטוח לאומי","ביטוחלאומי","ביטוח לאמי","ביטוח לאומי ישראל",
    "דמי אבטלה","אבטלה","מענק","גמלה","קצבה","קיצבה","קיצבה חודשית","פנסיה","קרן פנסיה","קרןפנסיה",
    "קופת גמל","קופתגמל","גמל","פנסיוני","פנסיונית",
    "מס הכנסה","מסהכנסה","מס הכנסה שנתי","דו\"ח שנתי","דו\"ח מס","דוח מס","מס שנתי",
    "החזר מס","החזרי מס","החזרמס","מע\"מ","מעמ","דיווח מע\"מ","דוח מע\"מ","דו\"ח מע\"מ",
    "ביטוח רכב","ביטוח רכב חובה","ביטוח חובה","ביטוח מקיף","ביטוחהדירה","ביטוח הדירה","פרמיה","פרמיית ביטוח",
    "פוליסה","פוליסת ביטוח","פרמיה לתשלום","חוב לתשלום","הודעת חיוב"
  ],
  "רפואה": [
    "רפואה","רפואי","רפואית","מסמך רפואי","מכתב רפואי","דוח רפואי",
    "מרפאה","מרפאה מומחה","מרפאת מומחים","מרפאת נשים","מרפאת ילדים",
    "קופת חולים","קופתחולים","קופה","קופת חולים כללית","כללית","מכבי","מאוחדת","לאומית",
    "רופא","רופאה","רופא משפחה","רופאת משפחה","רופא ילדים","רופאת ילדים",
    "סיכום ביקור","סיכוםביקור","סיכום מחלה","סיכום אשפוז","סיכום אשפוז ושחרור",
    "מכתב שחרור","שחרור מבית חולים","שחרור מבית\"ח","שחרור מבית חולים כללי",
    "בדיקת דם","בדיקות דם","בדיקות המים","בדיקה דם","בדיקות מעבדה","מעבדה","בדיקות מעבדה",
    "אבחנה","אבחון","אבחנה רפואית","דיאגנוזה","דיאגניזה","דיאגנוזה רפואית",
    "הפניה","הפניית","הפניה לבדיקות","הפניית לרופא מומחה","הפניה לרופא מומחה",
    "תור לרופא","תור לרופאה","זימון תור","זימון בדיקה","זימון בדיקות",
    "מרשם","מרשם תרופות","רשימת תרופות","תרופות","תרופה","טיפול תרופתי",
    "טיפול","טיפול רגשי","טיפול פסיכולוגי","פסיכולוג","פסיכולוגית","טיפול נפשי",
    "חיסון","חיסוני","תעודת התחסנות","פנקס חיסוני","כרטיס חיסוני","תעודת חיסוני",
    "אשפוז","אשפוז יום","מחלקה","בית חולים","ביתחולים","בי\"ח","ביה\"ח",
    "אישור מחלה","אישור מחלה לעבודה","אישור מחלה לבית ספר",
    "אישור רפואי","אישור כשירות","אישור כשירות רפואית",
    "טופס התחייבות","טופס 17","טופס17","התחייבות","התחיבות","התחיבות קופה","התחייבות קופה",
    "בדיקת קורונה","קורונה חיובי","קורונה שלילי","PCR","covid","בדיקת הריון","US","אולטרסאונד",
    "נכות רפואית","ועדה רפואית","קביעת נכות"
  ],
  "עבודה": [
    "חוזה העסקה","חוזה העסקה אישי","חוזה עבודה","חוזה העסקה לעובד","חוזה העסקה לעובדת",
    "מכתב קבלה לעבודה","קבלה לעבודה","מכתב התחלת עבודה","ברוכים הבאים לחברה",
    "אישור העסקה","אישור העסקה רשמי","אישור העסקה לעובד","אישור ותק","אישור שנות ותק","אישור ניסיון תעסוקתי",
    "תלוש שכר","תלוששכר","תלוש משכורת","תלושי שכר","תלושי משכורת","שעות נוספות","שעותנוספות","רשימת משמרות","משמרות",
    "שכר עבודה","שכר לשעה","שכר חודשי","טופס שעות","אישור תשלום",
    "הצהרת מעסיק","טופס למעסיק","אישור מעסיק","אישור העסקה לצורך ביטוח לאומי",
    "מכתב פיטורין","מכתב סיום העסקה","הודעה מוקדמת","שימוע לפני פיטורין","פיטורין","פיטורין",
    "סיום העסקה","סיום יחסי עובד מעביד","יחסי עובד מעביד","עובד","מעסיק","מעסיקה",
    "הערכת עובד","הערכת ביצועים","דו\"ח ביצועים","חוות דעת מנהל","משוב עובד"
  ],
  "בית": [
    "חוזה שכירות","חוזהשכירות","הסכם שכירות","הסכםשכירות","שוכר","שוכרת","שוכרים","משכיר","משכירה","דירה",
    "נכס","נכס מגורים","כתובת מגורים","מגורים קבועים","עדכון כתובת","הצהרת מגורים",
    "ועד בית","ועדבית","ועד בית חודשי","תשלום ועד בית","גביית ועד בית","ועד בנין",
    "חברת חשמל","חברת החשמל","חשמל","חשבון חשמל","קריאת מונה","מונה חשמל",
    "גז","חברת גז","קריאת מונה גז","מים","תאגיד מים","חשבון מים","מים חודשי",
    "אינטרנט","ספק אינטרנט","ראוטר","נתב","חשבונית אינטרנט","הוט","יס","HOT","yes","סיגיב","סיגיב אופטייס",
    "ארנונה","ארנונה מגורים","חוב ארנונה","הרשת תשלום ארנונה","ארנונה עירייה","עירייה",
    "גירושין","הסכם גירושין","צו גירושין","משמורת","צו משמורת","משמורת ילדים",
    "הסדרי ראייה","הסדרי ראיה","מזונות","דמי מזונות","תשלום מזונות","משפחה","משפחתי","הורה משמורן","הורה משמורנית"
  ],
  "אחריות": [
    "אחריות","אחריות למוצר","אחריות מוצר","אחריות יצרן","אחריות יבואן","אחריות יבואן רשמי",
    "אחריות יבואן מורשה","אחריות לשנה","אחריות לשנתיים","אחריות ל12 חודשים","אחריות ל-12 חודשים",
    "אחריות ל24 חודשים","אחריות ל-24 חודשים","שנת אחריות","שנתיים אחריות","תוך אחריות",
    "תאריך אחריות","תוך תקופת האחריות","סיומה של האחריות","פג תוקף אחריות","פג תוקף האחריות",
    "תעודת אחריות","ת.אחריות","ת. אחריות","תעודת-אחריות","כרטיס אחריות",
    "הוכחת קנייה","הוכחת קניה","אישור רכישה","חשבונית קנייה","תעודת משלוח","תעודת מסירה",
    "מספר סידורי","serial number","imei","rma","repair ticket","repair order"
  ],
  "תעודות": [
    "תעודת זהות","ת.ז","תז","תעודת לידה","ספח","ספח תעודת זהות","ספח ת.ז",
    "רישיון נהיגה","רישיון רכב","הרכון","passport","הרכון ביומטרי",
    "תעודת התחסנות","כרטיס חיסוני","אישור לימודים","אישור סטודנט","אישור תלמיד",
    "אישור מגורים","אישור כתובת","אישור תושבות"
  ],
  "עסק": [
    "עוסק מורשה","עוסק פטור","תיק עוסק","חשבונית מס","דיווח מע\"ם","עוסק מורשה פעיל",
    "חברה בע\"מ","ח.פ","מספר עוסק","הצעת מחיר","חשבונית ללקוח","ספק"
  ],
  "אחר": []
};

const CATEGORIES = [
  "כלכלה",
  "רפואה",
  "עבודה",
  "בית",
  "אחריות",
  "תעודות",
  "עסק",
  "אחר"
];

/*********************
 * 2. LocalStorage   *
 *********************/

const STORAGE_KEY = "docArchiveUsers";
const CURRENT_USER_KEY = "docArchiveCurrentUser";

function loadAllUsersDataFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.error("Couldn't parse storage", e);
    return {};
  }
}

function saveAllUsersDataToStorage(allUsersData) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(allUsersData));
}

function getCurrentUser() {
  return sessionStorage.getItem(CURRENT_USER_KEY);
}

function getUserDocs(username, allUsersData) {
  return allUsersData[username]?.docs || [];
}

function setUserDocs(username, docsArray, allUsersData) {
  if (!allUsersData[username]) {
    allUsersData[username] = { password: "", docs: [] };
  }
  allUsersData[username].docs = docsArray;
  saveAllUsersDataToStorage(allUsersData);
}

/*********************
 * 3. Utilities      *
 *********************/

function normalizeWord(word) {
  if (!word) return "";
  let w = word.trim().toLowerCase();
  if (w.startsWith("ו") && w.length > 1) {
    w = w.slice(1);
  }
  w = w.replace(/[",.():\[\]{}]/g, "");
  return w;
}

function guessCategoryForFileNameOnly(fileName) {
  const base = fileName.replace(/\.[^/.]+$/, "");
  const parts = base.split(/[\s_\-]+/g);
  const scores = {};

  for (const rawWord of parts) {
    const cleanWord = normalizeWord(rawWord);
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        const cleanKw = normalizeWord(kw);
        if (cleanWord.includes(cleanKw) || cleanKw.includes(cleanWord)) {
          if (!scores[cat]) scores[cat] = 0;
          scores[cat] += 1;
        }
      }
    }
  }

  let best = "אחר";
  let bestScore = 0;
  for (const [cat, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      best = cat;
      bestScore = sc;
    }
  }
  return best;
}

// OCR PDF
// OCR PDF (עם מסך טעינה)
async function extractTextFromPdfWithOcr(file) {
  showLoading("מזהה טקסט מה-PDF (OCR)...");
  try {
    if (!window.pdfjsLib) return "";
    const arrayBuf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuf }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!window.Tesseract) return "";

    const { data } = await window.Tesseract.recognize(blob, "heb+eng", {
      tessedit_pageseg_mode: 6,
    });
    return data && data.text ? data.text : "";
  } finally {
    hideLoading();
  }
}




// חילוץ אחריות אוטומטי
function extractWarrantyFromText(rawTextInput) {
  let rawText = "";
  if (typeof rawTextInput === "string") rawText = rawTextInput;
  else if (rawTextInput instanceof ArrayBuffer)
    rawText = new TextDecoder("utf-8").decode(rawTextInput);
  else rawText = String(rawTextInput || "");

  const rawLower = rawText.toLowerCase();
  const cleaned  = rawText.replace(/\s+/g, " ").trim();
  const lower    = cleaned.toLowerCase();

  function isValidYMD(ymd) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
    const [Y, M, D] = ymd.split("-").map(n => parseInt(n, 10));
    if (M < 1 || M > 12) return false;
    if (D < 1 || D > 31) return false;
    const dt = new Date(`${Y}-${String(M).padStart(2,"0")}-${String(D).padStart(2,"0")}T00:00:00`);
    return !Number.isNaN(dt.getTime());
  }

  const monthMap = {
    jan:"01", january:"01", feb:"02", february:"02", mar:"03", march:"03",
    apr:"04", april:"04", may:"05", jun:"06", june:"06", jul:"07", july:"07",
    aug:"08", august:"08", sep:"09", sept:"09", september:"09",
    oct:"10", october:"10", nov:"11", november:"11", dec:"12", december:"12",
    ינואר:"01", פברואר:"02", מרץ:"03", מרס:"03", אפריל:"04", מאי:"05",
    יוני:"06", יולי:"07", אוגוסט:"08", ספטמבר:"09", אוקטובר:"10",
    נובמבר:"11", דצמבר:"12",
  };

  function normalizeDateGuess(str) {
    if (!str) return null;
    let s = str
      .trim()
      .replace(/[,]/g, " ")
      .replace(/[^0-9a-zA-Zא-ת]+/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase();

    const tokens = s.split("-");
    if (tokens.some(t => monthMap[t])) {
      let day = null, mon = null, year = null;
      for (const t of tokens) {
        if (monthMap[t]) mon = monthMap[t];
        else if (/^\d{1,2}$/.test(t) && parseInt(t,10) <= 31 && day === null)
          day = t.padStart(2,"0");
        else if (/^\d{2,4}$/.test(t) && year === null) {
          if (t.length === 4) year = t;
          else {
            const yy = parseInt(t,10);
            year = (yy < 50 ? 2000+yy : 1900+yy).toString();
          }
        }
      }
      if (day && mon && year) {
        const ymd = `${year}-${mon}-${day}`;
        return isValidYMD(ymd) ? ymd : null;
      }
    }

    {
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (m) {
        const y  = m[1];
        const mo = m[2].padStart(2,"0");
        const d  = m[3].padStart(2,"0");
        const ymd = `${y}-${mo}-${d}`;
        if (isValidYMD(ymd)) return ymd;
      }
    }

    {
      const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      if (m) {
        const d  = m[1].padStart(2,"0");
        const mo = m[2].padStart(2,"0");
        const y  = m[3];
        const ymd = `${y}-${mo}-${d}`;
        if (isValidYMD(ymd)) return ymd;
      }
    }

    {
      const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
      if (m) {
        const d  = m[1].padStart(2,"0");
        const mo = m[2].padStart(2,"0");
        const yy = parseInt(m[3],10);
        const fullY = (yy < 50 ? 2000+yy : 1900+yy).toString();
        const ymd = `${fullY}-${mo}-${d}`;
        if (isValidYMD(ymd)) return ymd;
      }
    }

    return null;
  }

  function findDateAfterKeywords(keywords, textToSearch) {
    for (const kw of keywords) {
      const pattern =
        kw +
        "[ \\t:]*" +
        "(" +
          "\\d{1,2}[^0-9a-zA-Zא-ת]\\d{1,2}[^0-9a-zA-Zא-ת]\\d{2,4}" +
          "|" +
          "\\d{4}[^0-9a-zA-Zא-ת]\\d{1,2}[^0-9a-zA-Zא-ת]\\d{1,2}" +
          "|" +
          "\\d{1,2}\\s+[a-zא-ת]+\\s+\\d{2,4}" +
        ")";
      const re = new RegExp(pattern, "i");
      const m = textToSearch.match(re);
      if (m && m[1]) {
        const guess = normalizeDateGuess(m[1]);
        if (guess && isValidYMD(guess)) {
          return guess;
        }
      }
    }
    return null;
  }

  let warrantyStart = findDateAfterKeywords([
    "תאריך\\s*ק.?נ.?י.?ה",
    "תאריך\\s*רכישה",
    "תאריך\\s*קניה",
    "תאריך\\s*קנייה",
    "תאריך\\s*הקניה",
    "תאריך\\s*הקנייה",
    "תאריך\\s*חשבונית",
    "ת\\.?\\s*חשבונית",
    "תאריך\\s*תעודת\\s*משלוח",
    "תאריך\\s*משלוח",
    "תאריך\\s*אספקה",
    "תאריך\\s*מסירה",
    "נמסר\\s*בתאריך",
    "נרכש\\s*בתאריך",
    "purchase\\s*date",
    "date\\s*of\\s*purchase",
    "invoice\\s*date",
    "buy\\s*date"
  ], lower);

  let warrantyExpiresAt = findDateAfterKeywords([
    "תוקף\\s*אחריות",
    "תוקף\\s*האחריות",
    "האחריות\\s*בתוקף\\s*עד",
    "בתוקף\\s*עד",
    "אחריות\\s*עד",
    "warranty\\s*until",
    "warranty\\s*expiry",
    "warranty\\s*expires",
    "valid\\s*until",
    "expiry\\s*date",
    "expiration\\s*date"
  ], lower);

  if (!warrantyStart) {
    const headChunkRaw = rawLower.slice(0, 500);
    const headLines = headChunkRaw.split(/\r?\n/);
    for (const line of headLines) {
      const candidateMatch = line.match(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/);
      if (candidateMatch && candidateMatch[1]) {
        const guess = normalizeDateGuess(candidateMatch[1]);
        if (guess && isValidYMD(guess)) {
          warrantyStart = guess;
          break;
        }
      }
    }
  }

  if (!warrantyStart) {
    const anyDateRegex = /(\d{1,2}[^0-9a-zA-Zא-ת]\d{1,2}[^0-9a-zA-Zא-ת]\d{2,4}|\d{4}[^0-9a-zA-Zא-ת]\d{1,2}[^0-9a-zA-Zא-ת]\d{1,2}|\d{1,2}\s+[a-zא-ת]+\s+\d{2,4})/ig;
    const matches = [...rawLower.matchAll(anyDateRegex)].map(m => m[1]);
    const normalized = [];
    for (const candidate of matches) {
      const ymd = normalizeDateGuess(candidate);
      if (ymd && isValidYMD(ymd)) normalized.push(ymd);
    }
    const unique = [...new Set(normalized)];
    if (unique.length === 1) {
      warrantyStart = unique[0];
    }
  }

  if (!warrantyExpiresAt && warrantyStart && isValidYMD(warrantyStart)) {
    const [Y,M,D] = warrantyStart.split("-");
    const startDate = new Date(`${Y}-${M}-${D}T00:00:00`);
    if (!Number.isNaN(startDate.getTime())) {
      const endDate = new Date(startDate.getTime());
      endDate.setMonth(endDate.getMonth() + 12);
      const yyyy = endDate.getFullYear();
      const mm   = String(endDate.getMonth() + 1).padStart(2, "0");
      const dd   = String(endDate.getDate()).padStart(2, "0");
      warrantyExpiresAt = `${yyyy}-${mm}-${dd}`;
    }
  }

  // מחיקה אחרי 7 שנים מרגע הקנייה
  let autoDeleteAfter = null;
  if (warrantyStart && isValidYMD(warrantyStart)) {
    const [yS,mS,dS] = warrantyStart.split("-");
    const sDate = new Date(`${yS}-${mS}-${dS}T00:00:00`);
    if (!Number.isNaN(sDate.getTime())) {
      const del = new Date(sDate.getTime());
      del.setFullYear(del.getFullYear() + 7);
      const yy = del.getFullYear();
      const mm = String(del.getMonth() + 1).padStart(2, "0");
      const dd = String(del.getDate()).padStart(2, "0");
      autoDeleteAfter = `${yy}-${mm}-${dd}`;
    }
  }

  return {
    warrantyStart:     (warrantyStart     && isValidYMD(warrantyStart))     ? warrantyStart     : null,
    warrantyExpiresAt: (warrantyExpiresAt && isValidYMD(warrantyExpiresAt)) ? warrantyExpiresAt : null,
    autoDeleteAfter
  };
}

// fallback ידני לתאריכים
function fallbackAskWarrantyDetails() {
  const normalizeManualDate = (str) => {
    if (!str) return null;
    let s = str.trim().replace(/[.\/]/g, "-");
    const parts = s.split("-");
    if (parts.length === 3) {
      let [a,b,c] = parts;
      if (a.length === 4) {
        const yyyy = a;
        const mm = b.padStart(2, "0");
        const dd = c.padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      } else if (c.length === 4) {
        const yyyy = c;
        const mm = b.padStart(2, "0");
        const dd = a.padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    }
    return s;
  };

  const startAns = prompt(
    "לא הצלחתי לזהות אוטומטית.\nמה תאריך הקנייה? (למשל 28/10/2025)"
  );
  const expAns = prompt(
    "עד מתי האחריות בתוקף? (למשל 28/10/2026)\nאם אין אחריות/לא רלוונטי אפשר לבטל."
  );

  const warrantyStart = startAns ? normalizeManualDate(startAns) : null;
  const warrantyExpiresAt = expAns ? normalizeManualDate(expAns) : null;

  let autoDeleteAfter = null;
  if (warrantyStart && /^\d{4}-\d{2}-\d{2}$/.test(warrantyStart)) {
    const delDate = new Date(warrantyStart + "T00:00:00");
    delDate.setFullYear(delDate.getFullYear() + 7);
    autoDeleteAfter = delDate.toISOString().split("T")[0];
  }

  return {
    warrantyStart,
    warrantyExpiresAt,
    autoDeleteAfter
  };
}

// טוסט
function showNotification(message, isError = false) {
  const box = document.getElementById("notification");
  if (!box) return;
  box.textContent = message;
  box.className = "notification show" + (isError ? " error" : "");
  setTimeout(() => {
    box.className = "notification hidden";
  }, 4000);
}


// --- Loading overlay helpers ---
function showLoading(msg = "מזהה טקסט... אנא המתיני") {
  const el = document.getElementById("loading-overlay");
  if (!el) return;
  const t = el.querySelector(".loading-text");
  if (t) t.textContent = msg;
  el.classList.remove("hidden");
}
function hideLoading() {
  const el = document.getElementById("loading-overlay");
  if (!el) return;
  el.classList.add("hidden");
}

// ניקוי אוטומטי לאחר שפג תאריך המחיקה
function purgeExpiredWarranties(docsArray) {
  const today = new Date();
  let changed = false;
  for (let i = docsArray.length - 1; i >= 0; i--) {
    const d = docsArray[i];
    if (d.category && d.category.includes("אחריות") && d.autoDeleteAfter) {
      const deleteOn = new Date(d.autoDeleteAfter + "T00:00:00");
      if (today > deleteOn) {
        // גם מוחקים את הקובץ בפועל מה-DB
        deleteFileFromDB(d.id).catch(() => {});
        docsArray.splice(i, 1);
        changed = true;
      }
    }
  }
  return changed;
}

// מיון לתצוגה
let currentSortField = "uploadedAt";
let currentSortDir   = "desc";

function sortDocs(docsArray) {
  const arr = [...docsArray];
  arr.sort((a, b) => {
    let av = a[currentSortField];
    let bv = b[currentSortField];

    if (
      currentSortField === "uploadedAt" ||
      currentSortField === "warrantyExpiresAt" ||
      currentSortField === "autoDeleteAfter" ||
      currentSortField === "warrantyStart"
    ) {
      const ad = av ? new Date(av) : new Date(0);
      const bd = bv ? new Date(bv) : new Date(0);
      if (ad < bd) return currentSortDir === "asc" ? -1 : 1;
      if (ad > bd) return currentSortDir === "asc" ? 1 : -1;
      return 0;
    }

    if (currentSortField === "year") {
      const an = parseInt(av ?? 0, 10);
      const bn = parseInt(bv ?? 0, 10);
      if (an < bn) return currentSortDir === "asc" ? -1 : 1;
      if (an > bn) return currentSortDir === "asc" ? 1 : -1;
      return 0;
    }

    av = (av ?? "").toString().toLowerCase();
    bv = (bv ?? "").toString().toLowerCase();
    if (av < bv) return currentSortDir === "asc" ? -1 : 1;
    if (av > bv) return currentSortDir === "asc" ? 1 : -1;
    return 0;
  });
  return arr;
}


function normalizeEmail(e) { 
  return (e || "").trim().toLowerCase(); 
}

function findUsernameByEmail(allUsersData, email) {
  const target = normalizeEmail(email);
  for (const [uname, u] of Object.entries(allUsersData)) {
    const userEmail = normalizeEmail(u.email || uname);
    if (userEmail === target) return uname;
  }
  return null;
}

function ensureUserSharedFields(allUsersData, username) {
  if (!allUsersData[username]) {
    allUsersData[username] = { password: "", docs: [], email: username };
  }
  const u = allUsersData[username];

  if (!u.email) {
    const looksLikeEmail = /.+@.+\..+/.test(username);
    u.email = looksLikeEmail ? username : username;
  }

  if (!u.sharedFolders) u.sharedFolders = {};
  if (!u.incomingShareRequests) u.incomingShareRequests = [];
  if (!u.outgoingShareRequests) u.outgoingShareRequests = [];
}

/*********************
 * 4. אפליקציה / UI  *
 *********************/

document.addEventListener("DOMContentLoaded", async () => {


  const panel = document.getElementById("premiumPanel");
  const modal = panel?.querySelector(".modal");
  const btnOpen = document.getElementById("premiumBtn");
  const btnClose = document.getElementById("premiumCloseBtn");
  const btnLater = document.getElementById("premiumLaterBtn");

  function openPremiumPanel() {
    panel?.classList.remove("hidden");
    panel?.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden"; // lock page scroll
    modal?.focus();
  }


  function closePremiumPanel() {
    panel?.classList.add("hidden");
    panel?.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = ""; // restore page scroll
    btnOpen?.focus();
  }

  // open from top-right button
  btnOpen?.addEventListener("click", openPremiumPanel);

  // close actions
  btnClose?.addEventListener("click", closePremiumPanel);
  btnLater?.addEventListener("click", closePremiumPanel);

  // click outside modal to close
  panel?.addEventListener("click", (e) => {
    if (e.target === panel) closePremiumPanel();
  });

  // ESC to close
  panel?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePremiumPanel();
  });

  // plan selection (hook to payments / Firestore later)
  panel?.querySelectorAll("[data-select-plan]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const plan = e.currentTarget.getAttribute("data-select-plan"); // "pro" | "premium"
      // TODO: integrate checkout and/or Firestore update here:
      // await setDoc(doc(db, "users", userEmail), { plan }, { merge: true });
      alert("נבחרה תוכנית: " + (plan === "pro" ? "פרו" : "פרימיום"));
      closePremiumPanel();
    });
  });




  const currentUser   = getCurrentUser();
  if (!currentUser) {
    // אם אין משתמש שמור, אפשר פשוט לבחור "ברירת מחדל"
    // או להפנות למסך התחברות אם יש לך אחד
    sessionStorage.setItem(CURRENT_USER_KEY, "defaultUser");
  }

  const userNow = getCurrentUser() || "defaultUser";

  

  const homeView      = document.getElementById("homeView");
  const folderGrid    = document.getElementById("folderGrid");
  const categoryView  = document.getElementById("categoryView");
  const categoryTitle = document.getElementById("categoryTitle");
  const docsList      = document.getElementById("docsList");
  const backButton    = document.getElementById("backButton");
  const uploadBtn     = document.getElementById("uploadBtn");
  const fileInput     = document.getElementById("fileInput");
  const sortSelect    = document.getElementById("sortSelect");

  // אלמנטים של מודאל עריכה
  const editModal           = document.getElementById("editModal");
  const editForm            = document.getElementById("editForm");
  const editCancelBtn       = document.getElementById("editCancelBtn");

  const edit_title          = document.getElementById("edit_title");
  const edit_org            = document.getElementById("edit_org");
  const edit_year           = document.getElementById("edit_year");
  const edit_recipient      = document.getElementById("edit_recipient");
  const edit_warrantyStart  = document.getElementById("edit_warrantyStart");
  const edit_warrantyExp    = document.getElementById("edit_warrantyExpiresAt");
  const edit_autoDelete     = document.getElementById("edit_autoDeleteAfter");
  const edit_category       = document.getElementById("edit_category");
  const edit_sharedWith     = document.getElementById("edit_sharedWith");

  let currentlyEditingDocId = null;

  // טוענים נתונים מה- localStorage
  let allUsersData = loadAllUsersDataFromStorage();
  let allDocsData  = getUserDocs(userNow, allUsersData);

function normalizeEmail(e) { return (e || "").trim().toLowerCase(); }

  // === INIT shared fields (run once after loading allUsersData/allDocsData) ===
function ensureUserSharedFields(allUsersData, username) {
  if (!allUsersData[username]) {
    allUsersData[username] = { password: "", docs: [], email: username };
  }
  const u = allUsersData[username];

  if (!u.email) {
    const looksLikeEmail = /.+@.+\..+/.test(username);
    u.email = looksLikeEmail ? username : username;
  }

  if (!u.sharedFolders) u.sharedFolders = {};
  if (!u.incomingShareRequests) u.incomingShareRequests = [];
  if (!u.outgoingShareRequests) u.outgoingShareRequests = [];
}


function findUsernameByEmail(allUsersData, email) {
  const target = (email || "").trim().toLowerCase();
  for (const [uname, u] of Object.entries(allUsersData)) {
    const userEmail = (u.email || uname).trim().toLowerCase();
    if (userEmail === target) return uname;
  }
  return null;
}
ensureUserSharedFields(allUsersData, userNow);
saveAllUsersDataToStorage(allUsersData);
          
  if (!allDocsData || allDocsData.length === 0) {
    allDocsData = [];
    setUserDocs(userNow, allDocsData, allUsersData);
  }

  // מסירים אחריות שפג תוקפה
  const removed = purgeExpiredWarranties(allDocsData);
  if (removed) {
    setUserDocs(userNow, allDocsData, allUsersData);
    showNotification("מסמכי אחריות ישנים הוסרו אוטומטית");
  }

  // כפתורי התיקיות בעמוד הבית
  function renderFolderItem(categoryName) {
    const folder = document.createElement("button");
    folder.className = "folder-card";
    folder.setAttribute("data-category", categoryName);

    folder.innerHTML = `
      <div class="folder-icon"></div>
      <div class="folder-label">${categoryName}</div>
    `;

    folder.addEventListener("click", () => {
      openCategoryView(categoryName);
    });

    folderGrid.appendChild(folder);
  }

  function renderHome() {
    folderGrid.innerHTML = "";
    CATEGORIES.forEach(cat => {
      renderFolderItem(cat);
    });

    homeView.classList.remove("hidden");
    categoryView.classList.add("hidden");
  }

  function buildDocCard(doc, mode) {
    const card = document.createElement("div");
    card.className = "doc-card";

    const warrantyBlock =
      (doc.category && doc.category.includes("אחריות")) ?
      `
        <span>הועלה ב: ${doc.uploadedAt || "-"}</span>
        <span>תאריך קנייה: ${doc.warrantyStart || "-"}</span>
        <span>תוקף אחריות עד: ${doc.warrantyExpiresAt || "-"}</span>
        <span>מחיקה אוטומטית אחרי: ${doc.autoDeleteAfter || "-"}</span>
      `
      : `
        <span>הועלה ב: ${doc.uploadedAt || "-"}</span>
      `;

    const openFileButtonHtml = `
      <button class="doc-open-link"
              data-open-id="${doc.id}">
        פתיחת קובץ
      </button>
    `;

  // Use title, fallback to fileName, fallback to originalFileName
const displayTitle = doc.title || doc.fileName || doc.originalFileName || "מסמך";


card.innerHTML = `
  <p class="doc-card-title">${displayTitle}</p>
      <div class="doc-card-meta">
        <span>ארגון: ${doc.org || "לא ידוע"}</span>
        <span>שנה: ${doc.year || "-"}</span>
        <span>שייך ל: ${doc.recipient?.join(", ") || "-"}</span>
        ${warrantyBlock}
      </div>

      ${openFileButtonHtml}

      <div class="doc-actions"></div>
    `;

    const actions = card.querySelector(".doc-actions");

    if (mode !== "recycle") {
      const editBtn = document.createElement("button");
      editBtn.className = "doc-action-btn";
      editBtn.textContent = "עריכה ✏️";
      editBtn.addEventListener("click", () => {
        openEditModal(doc);
      });
      actions.appendChild(editBtn);

      const trashBtn = document.createElement("button");
      trashBtn.className = "doc-action-btn danger";
      trashBtn.textContent = "העבר לסל מחזור 🗑️";
      trashBtn.addEventListener("click", () => {
        markDocTrashed(doc.id, true);

        const currentCat = categoryTitle.textContent;
        if (currentCat === "אחסון משותף") {
          openSharedView();
        } else if (currentCat === "סל מחזור") {
          openRecycleView();
        } else {
          openCategoryView(currentCat);
        }
      });
      actions.appendChild(trashBtn);

      // כפתור: הכנס לתיקייה משותפת
const addToSharedBtn = document.createElement("button");
addToSharedBtn.className = "doc-action-btn";
addToSharedBtn.textContent = "הכנס לתיקייה משותפת";
addToSharedBtn.addEventListener("click", () => {
  const me = allUsersData[userNow];
  openSharedFolderPicker(me, async (folderId) => {
    const docId = doc.id;
    const i = allDocsData.findIndex(d => d.id === docId);
    if (i > -1) {
      allDocsData[i].sharedFolderId = folderId;
      setUserDocs(userNow, allDocsData, allUsersData);
      
      // Sync to Firestore immediately
      if (isFirebaseAvailable()) {
        showLoading("משתף מסמך...");
        try {
          await upsertSharedDocRecord(allDocsData[i], folderId);
          console.log("✅ Document synced to Firestore for all members");
        } catch (e) {
          console.error("Error syncing document:", e);
        }
        hideLoading();
      }
      
      showNotification("המסמך שויך לתיקייה המשותפת ✅");
      const currentCat = categoryTitle.textContent;
      if (currentCat === "אחסון משותף") {
        openSharedView();
      } else if (currentCat === "סל מחזור") {
        openRecycleView();
      } else {
        openCategoryView(currentCat);
      }
    }
  });
});

actions.appendChild(addToSharedBtn);


    } else {
      const restoreBtn = document.createElement("button");
      restoreBtn.className = "doc-action-btn restore";
      restoreBtn.textContent = "שחזור ♻️";
      restoreBtn.addEventListener("click", () => {
        markDocTrashed(doc.id, false);
        openRecycleView();
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "doc-action-btn danger";
      deleteBtn.textContent = "מחיקה לצמיתות 🗑️";
      deleteBtn.addEventListener("click", () => {
        deleteDocForever(doc.id);
        openRecycleView();
      });

      actions.appendChild(restoreBtn);
      actions.appendChild(deleteBtn);
    }

    return card;
  }

  function openCategoryView(categoryName) {
    categoryTitle.textContent = categoryName;

    let docsForThisCategory = allDocsData.filter(doc =>
      doc.category &&
      doc.category.includes(categoryName) &&
      !doc._trashed
    );

    docsForThisCategory = sortDocs(docsForThisCategory);

    docsList.innerHTML = "";
    docsForThisCategory.forEach(doc => {
      const card = buildDocCard(doc, "normal");
      docsList.appendChild(card);
    });

    homeView.classList.add("hidden");
    categoryView.classList.remove("hidden");
  }

  function renderDocsList(docs, mode = "normal") {
    const sortedDocs = sortDocs(docs);
    docsList.innerHTML = "";
    sortedDocs.forEach(doc => {
      const card = buildDocCard(doc, mode);
      docsList.appendChild(card);
    });

    homeView.classList.add("hidden");
    categoryView.classList.remove("hidden");
  }

  // === HELPER: אסוף מסמכים מכל המשתמשים לתיקייה משותפת מסוימת ===
function collectSharedFolderDocs(allUsersData, folderId) {
  const list = [];
  for (const [uname, u] of Object.entries(allUsersData)) {
    const docs = (u.docs || []);
    for (const d of docs) {
      if (!d._trashed && d.sharedFolderId === folderId) {
        // מצרפים גם שם מעלה המסמך:
        list.push({ ...d, _ownerEmail: u.email || uname });
      }
    }
  }
  return list;
}


// ===== Smart Shared-Folder Picker (modal) =====
function createEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    if (typeof c === "string") el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  });
  return el;
}

function openSharedFolderPicker(me, onSelect) {
  const folders = Object.entries(me.sharedFolders || {}); // [ [fid, {name,...}], ... ]
  if (!folders.length) {
    showNotification("אין לך עדיין תיקיות משותפות. צרי אחת במסך 'אחסון משותף'.", true);
    return;
  }

  // Overlay
  const overlay = createEl("div", { style: {
    position: "fixed", inset: "0", background: "rgba(0,0,0,.45)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: "10000", fontFamily: "Rubik,system-ui,sans-serif"
  }});

  const panel = createEl("div", { style: {
    background: "#fff", color:"#000", width:"min(520px, 92vw)", maxHeight:"80vh",
    borderRadius:"12px", padding:"12px", boxShadow:"0 18px 44px rgba(0,0,0,.45)",
    display: "grid", gridTemplateRows:"auto auto 1fr auto", gap:"10px"
  }});

  const title = createEl("div", { style:{fontWeight:"700"} }, "בחרי תיקייה משותפת");
  const search = createEl("input", { type:"text", placeholder:"חיפוש לפי שם תיקייה...", style:{
    padding:".5rem", border:"1px solid #bbb", borderRadius:"8px", width:"100%"
  }});
  const listWrap = createEl("div", { style:{
    overflow:"auto", border:"1px solid #eee", borderRadius:"8px", padding:"6px"
  }});
  const btnRow = createEl("div", { style:{ display:"flex", gap:"8px", justifyContent:"flex-end" }});
  const cancelBtn = createEl("button", { class:"doc-action-btn", style:{background:"#b63a3a", color:"#fff"}}, "בטל");
  const chooseBtn = createEl("button", { class:"doc-action-btn", style:{background:"#0e3535", color:"#fff"}}, "בחרי");

  btnRow.append(cancelBtn, chooseBtn);
  panel.append(title, search, listWrap, btnRow);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let selectedId = null;

  function renderList(filter = "") {
    listWrap.innerHTML = "";
    const norm = (s) => (s||"").toString().toLowerCase().trim();
    const f = norm(filter);
    const filtered = folders.filter(([fid, fobj]) => norm(fobj.name).includes(f));

    filtered.forEach(([fid, fobj]) => {
      const row = createEl("label", { style:{
        display:"grid", gridTemplateColumns:"24px 1fr", alignItems:"center",
        gap:"8px", padding:"6px", borderRadius:"6px", cursor:"pointer"
      }});
      row.addEventListener("mouseover", () => row.style.background = "#f7f7f7");
      row.addEventListener("mouseout",  () => row.style.background = "transparent");

      const radio = createEl("input", { type:"radio", name:"sf_pick", value: fid });
      const name  = createEl("div", {}, `${fobj.name}  `);
      row.append(radio, name);
      listWrap.appendChild(row);

      radio.addEventListener("change", () => { selectedId = fid; });
    });

    if (!filtered.length) {
      listWrap.appendChild(createEl("div", { style:{opacity:.7, padding:"8px"}}, "לא נמצאו תיקיות מתאימות"));
    }
  }

  renderList();
  search.addEventListener("input", () => renderList(search.value));

  cancelBtn.onclick = () => { overlay.remove(); };
  chooseBtn.onclick = () => {
    if (!selectedId) { showNotification("בחרי תיקייה מהרשימה", true); return; }
    overlay.remove();
    if (typeof onSelect === "function") onSelect(selectedId);
  };
}


// === UI: רינדור ניהול תיקיות משותפות + בקשות ממתינות ===
function openSharedView() {
  docsList.classList.remove("shared-mode");

  categoryTitle.textContent = "אחסון משותף";
  docsList.innerHTML = "";

  docsList.classList.add("shared-mode");

  const me = allUsersData[userNow];
  const myEmail = (me.email || userNow);

  // ===== עטיפת ניהול =====
  const wrap = document.createElement("div");
wrap.className = "shared-container";

  // --- בלוק בקשות ממתינות (למעלה) ---
  const pendingBox = document.createElement("div");
  pendingBox.className = "pending-wrap";
  pendingBox.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <strong>בקשות ממתינות</strong>
      <small style="opacity:.8">הזמנות שממתינות לאישור</small>
    </div>
    <div id="sf_pending"></div>
  `;
  wrap.appendChild(pendingBox);

  // --- שורת כותרת + כפתור יצירה (באותה שורה) ---
  const headRow = document.createElement("div");
  headRow.className = "cozy-head";
  headRow.innerHTML = `
    <h3 style="margin:0;">תיקיות משותפות</h3>
    <button id="sf_create_open" class="btn-cozy">+ צור תיקייה</button>
  `;
  wrap.appendChild(headRow);

  // --- רשימת תיקיות ---
  const listWrap = document.createElement("div");
  listWrap.className = "sf-list";
  listWrap.id = "sf_list";
  wrap.appendChild(listWrap);

  docsList.appendChild(wrap);

  // ===== מודאל יצירת תיקייה =====
  function openCreateFolderModal() {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.45);
      display:flex; align-items:center; justify-content:center; z-index:9999;
      font-family: Rubik,system-ui,sans-serif;
    `;
    const panel = document.createElement("div");
    panel.style.cssText = `
      background:#0b1010; color:#e7f0ee; width:min(520px,92vw);
      border:1px solid #243030; border-radius:14px; padding:14px;
      box-shadow:0 18px 44px rgba(0,0,0,.5); display:grid; gap:10px;
      grid-template-rows:auto auto auto;
    `;
    panel.innerHTML = `
      <div style="font-weight:700;display:flex;justify-content:space-between;align-items:center;">
        <span>יצירת תיקייה משותפת</span>
        <button id="mk_close" class="btn-min">סגור</button>
      </div>
      <input id="mk_name" placeholder="שם תיקייה חדשה"
             style="padding:.6rem;border:1px solid #2b3c3c;border-radius:10px;background:#101a1a;color:#e0f0ee;">
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="mk_create" class="btn-cozy">צור</button>
      </div>
    `;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.querySelector("#mk_close").onclick = () => overlay.remove();
    panel.querySelector("#mk_create").onclick = () => {
      const name = (panel.querySelector("#mk_name").value || "").trim();
      if (!name) { showNotification("צריך שם תיקייה", true); return; }
      const fid = crypto.randomUUID();
      me.sharedFolders[fid] = { name, owner: myEmail, members: [myEmail] };
      saveAllUsersDataToStorage(allUsersData);
      overlay.remove();
      renderSharedFoldersList();
      showNotification(`נוצרה תיקייה "${name}"`);
    };
  }

  headRow.querySelector("#sf_create_open").addEventListener("click", openCreateFolderModal);

  // ===== רינדור תיקיות =====
  function renderSharedFoldersList() {
    listWrap.innerHTML = "";

    const sfs = me.sharedFolders || {};
    const entries = Object.entries(sfs);
    if (!entries.length) {
      listWrap.innerHTML = `<div style="opacity:.7">אין עדיין תיקיות משותפות</div>`;
      return;
    }

    for (const [fid, folder] of entries) {
      const roleLabel = (folder.owner?.toLowerCase() === (myEmail||"").toLowerCase()) ? "owner" : "member";
      const row = document.createElement("div");
      row.className = "sf-card";
      row.innerHTML = `
        <div class="sf-ico">📁</div>
        <div class="sf-main">
          <div class="sf-title">${folder.name}</div>
          <div class="sf-meta">Role: ${roleLabel}</div>
        </div>
        <div class="sf-actions">
          <button data-open="${fid}" class="btn-min">פתח</button>
          <button data-rename="${fid}" class="btn-min">שנה שם</button>
          <button data-delete="${fid}" class="btn-min btn-danger">מחק</button>
        </div>
      `;
      listWrap.appendChild(row);
    }
  }


  // מצייר רק את ה-UI לפי מערך הזמנות שניתן
function paintPending(invites) {
  const wrap = pendingBox.querySelector("#sf_pending");
  wrap.innerHTML = "";

  if (!invites || !invites.length) {
    wrap.innerHTML = `<div style="opacity:.7">אין בקשות ממתינות</div>`;
    return;
  }

  for (const inv of invites) {
    const line = document.createElement("div");
    line.className = "pending-row";
    line.innerHTML = `
      הזמנה לתיקייה "<b>${inv.folderName}</b>" מאת ${inv.fromEmail}
      <div>
        <button class="btn-min" data-accept="${inv.id}" data-folder="${inv.folderId}" data-fname="${inv.folderName}" data-owner="${inv.fromEmail}">אשר</button>
        <button class="btn-min btn-danger" data-reject="${inv.id}">סרב</button>
      </div>
    `;
    wrap.appendChild(line);
  }
}



  // ===== רינדור בקשות =====
async function renderPending() {
  const wrap = pendingBox.querySelector("#sf_pending");
  wrap.innerHTML = "<div style='opacity:.7'>טוען הזמנות...</div>";
  
  const myEmail = normalizeEmail((allUsersData[userNow].email || userNow));
  console.log("📩 Fetching pending invites for:", myEmail);
  
  const invites = await getPendingInvitesFromFirestore(myEmail);
  console.log("📩 Found", invites.length, "pending invites");
  
  paintPending(invites);
}

  renderSharedFoldersList();
  renderPending();

  // ===== הפעלציה של מקשיב זמן אמת להזמנות =====
  if (stopWatching) stopWatching(); // ניקוי מקשיב קודם
  stopWatching = watchPendingInvites(async (invites) => {
    console.log("🔔 Real-time update: received", invites.length, "invites");
    paintPending(invites);
  });

  // ===== אירועים על רשימת התיקיות =====
  listWrap.addEventListener("click", async (ev) => {
    const t = ev.target;
    const openId   = t.getAttribute?.("data-open");
    const renameId = t.getAttribute?.("data-rename");
    const delId    = t.getAttribute?.("data-delete");

    // --- פתיחת עמוד תיקייה ---
    if (openId) {
      // Header: משתתפים + הוספת משתתף משמאל
      categoryTitle.textContent = me.sharedFolders[openId]?.name || "תיקייה משותפת";
      docsList.innerHTML = "";

      // שורת "משתתפים" + הוספה
      const membersBar = document.createElement("div");
      membersBar.className = "cozy-head";
      membersBar.innerHTML = `
        <h3 style="margin:0;">משתתפים</h3>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="detail_inv_email" placeholder="הוסף מייל לשיתוף"
                 style="padding:.5rem;border:1px solid #2b3c3c;border-radius:10px;background:#101a1a;color:#e0f0ee;min-width:220px;">
          <button id="detail_inv_btn" class="btn-cozy">הוסף משתתף</button>
        </div>
      `;
      docsList.appendChild(membersBar);

      // רשימת משתתפים
     // רשימת משתתפים (Firestore live)
const membersList = document.createElement("div");
membersList.className = "pending-wrap";
membersList.style.gap = "6px";
membersList.innerHTML = `<div id="members_chips" style="display:flex;flex-wrap:wrap;gap:8px;"></div>`;
docsList.appendChild(membersList);

const ownerEmailForThisFolder = (me.sharedFolders[openId]?.owner || "").toLowerCase();
const chips = membersList.querySelector("#members_chips");

const paintMembers = (arr = []) => {
  chips.innerHTML = arr.map(email => `<span class="btn-min" style="cursor:default">${email}</span>`).join("");
};

// first paint + live updates
if (isFirebaseAvailable()) {
  // one-time fetch
  fetchFolderMembersFromOwner(ownerEmailForThisFolder, openId)
    .then(paintMembers)
    .catch(err => console.warn("fetchFolderMembersFromOwner failed", err));

  // live
  if (window._stopMembersWatch) try { window._stopMembersWatch(); } catch(e) {}
  window._stopMembersWatch = watchFolderMembersFromOwner(ownerEmailForThisFolder, openId, paintMembers);
} else {
  // offline fallback from local cache
  paintMembers(me.sharedFolders[openId]?.members || []);
}


      
      // כותרת "מסמכים משותפים"
const docsHead = document.createElement("div");
docsHead.className = "cozy-head";
docsHead.innerHTML = `
  <h3 style="margin:0;">מסמכים משותפים</h3>
  <button id="refresh_docs_btn" class="btn-cozy">🔄 רענן רשימה</button>
`;
docsList.appendChild(docsHead);

// קונטיינר הכרטיסיות – גריד רספונסיבי
const docsBox = document.createElement("div");
docsBox.style.display = "grid";
docsBox.style.gap = "24px";
docsBox.className = "docs-grid";
docsBox.style.gridTemplateColumns = "repeat(auto-fit, minmax(260px, 1fr))";
docsBox.style.alignItems = "start";
docsBox.style.justifyItems = "stretch";
docsList.appendChild(docsBox);


      // Prefer Firestore (cross-device). Fallback to local for offline.
// Prefer Firestore (cross-device). Fallback to local for offline.
// Prefer Firestore (cross-device). Fallback to local for offline.
async function loadAndDisplayDocs() {
  docsBox.innerHTML = "<div style='opacity:.7;padding:20px;text-align:center'>טוען מסמכים...</div>";
  
  if (isFirebaseAvailable()) {
    await syncMySharedDocsToFirestore();

    const first = await fetchSharedFolderDocsFromFirestore(openId);
    docsBox.innerHTML = "";
    
    if (first.length === 0) {
      docsBox.innerHTML = "<div style='opacity:.7;padding:20px;text-align:center'>אין עדיין מסמכים בתיקייה זו</div>";
    } else {
      sortDocs(first).forEach(d => {
        const card = buildDocCard(d, "shared");
        const meta = card.querySelector(".doc-card-meta");
        if (meta) {
          const span = document.createElement("span");
          span.textContent = `הועלה ע"י: ${d._ownerEmail || "-"}`;
          meta.appendChild(span);
        }
        docsBox.appendChild(card);
      });
    }

    if (window._stopSharedDocsWatch) try { window._stopSharedDocsWatch(); } catch(e) {}
    window._stopSharedDocsWatch = watchSharedFolderDocs(openId, (rows) => {
      console.log("🔄 Real-time update: received", rows.length, "documents");
      docsBox.innerHTML = "";
      if (rows.length === 0) {
        docsBox.innerHTML = "<div style='opacity:.7;padding:20px;text-align:center'>אין עדיין מסמכים בתיקייה זו</div>";
      } else {
        sortDocs(rows).forEach(d => {
          const card = buildDocCard(d, "shared");
          const meta = card.querySelector(".doc-card-meta");
          if (meta) {
            const span = document.createElement("span");
            span.textContent = `הועלה ע"י: ${d._ownerEmail || "-"}`;
            meta.appendChild(span);
          }
          docsBox.appendChild(card);
        });
      }
    });
  } else {
    const docs = collectSharedFolderDocs(allUsersData, openId);
    const sorted = sortDocs(docs);
    docsBox.innerHTML = "";
    
    if (sorted.length === 0) {
      docsBox.innerHTML = "<div style='opacity:.7;padding:20px;text-align:center'>אין עדיין מסמכים בתיקייה זו (מצב לא מקוון)</div>";
    } else {
      for (const d of sorted) {
        const card = buildDocCard(d, "shared");
        const meta = card.querySelector(".doc-card-meta");
        if (meta) {
          const span = document.createElement("span");
          span.textContent = `הועלה ע"י: ${d._ownerEmail || "-"}`;
          meta.appendChild(span);
        }
        docsBox.appendChild(card);
      }
    }
  }
}

// Initial load
await loadAndDisplayDocs();

// Refresh button handler
docsHead.querySelector("#refresh_docs_btn").addEventListener("click", async () => {
  showNotification("מרענן רשימת מסמכים...");
  await loadAndDisplayDocs();
  showNotification("הרשימה עודכנה ✅");
});



      // לחצן הזמנה במסך פרטי התיקייה – אותה לוגיקה בדיוק
membersBar.querySelector("#detail_inv_btn").addEventListener("click", async () => {
  const emailEl = membersBar.querySelector("#detail_inv_email");
  const targetEmail = (emailEl.value || "").trim().toLowerCase();
  
  if (!targetEmail) { 
    showNotification("הקלידי מייל של הנמען", true); 
    return; 
  }

  const myEmail = (allUsersData[userNow].email || userNow).toLowerCase();
  if (targetEmail === myEmail) { 
    showNotification("את כבר חברה בתיקייה הזו", true); 
    return; 
  }

  // בדיקה ב-Firestore אם המשתמש קיים
  showLoading("בודק אם המשתמש קיים...");
  const exists = await checkUserExistsInFirestore(targetEmail);
  hideLoading();
  
  if (!exists) { 
    showNotification("אין משתמש עם המייל הזה במערכת", true); 
    return; 
  }

  // שליחת הזמנה ל-Firestore
  showLoading("שולח הזמנה...");
  const meUser = allUsersData[userNow];
  const folderName = meUser.sharedFolders[openId]?.name || "";
  
  const success = await sendShareInviteToFirestore(
    myEmail,
    targetEmail,
    openId,
    folderName
  );
  
  hideLoading();
  
  if (success) {
    showNotification("ההזמנה נשלחה בהצלחה! ✉️");
    emailEl.value = "";
  } else {
    showNotification("שגיאה בשליחת ההזמנה, נסי שוב", true);
  }
});


      return;
    }

    // --- שינוי שם (לכל החברים) ---
    if (renameId) {
      const newName = prompt("שם חדש לתיקייה:", me.sharedFolders[renameId]?.name || "");
      if (!newName) return;

      for (const [, u] of Object.entries(allUsersData)) {
        if (u.sharedFolders && u.sharedFolders[renameId]) {
          u.sharedFolders[renameId].name = newName.trim();
        }
        (u.incomingShareRequests || []).forEach(r => { if (r.folderId === renameId) r.folderName = newName; });
        (u.outgoingShareRequests || []).forEach(r => { if (r.folderId === renameId) r.folderName = newName; });
      }
      saveAllUsersDataToStorage(allUsersData);
      renderSharedFoldersList();
      showNotification("שם התיקייה עודכן");
      return;
    }

    // --- מחיקה ---
    if (delId) {
      const fname = me.sharedFolders[delId]?.name || "";
      if (!confirm(`למחוק לצמיתות את התיקייה "${fname}"? (המסמכים לא יימחקו, רק ינותק השיוך)`)) return;
      if (typeof deleteSharedFolderEverywhere === "function") {
        deleteSharedFolderEverywhere(delId);
      } else {
        // Fallback: מחיקה רק אצלי
        delete me.sharedFolders[delId];
        for (const d of (allUsersData[userNow].docs || [])) {
          if (d.sharedFolderId === delId) d.sharedFolderId = null;
        }
        saveAllUsersDataToStorage(allUsersData);
      }
      showNotification("התיקייה הוסרה. המסמכים נשארו בארכיונים של בעליהם.");
      renderSharedFoldersList();
      return;
    }
  });

pendingBox.addEventListener("click", async (ev) => {
  const t = ev.target;
  const accId = t.getAttribute?.("data-accept");
  const rejId = t.getAttribute?.("data-reject");
  
  if (!accId && !rejId) return;

  const myEmail = (allUsersData[userNow].email || userNow).toLowerCase();

  if (accId) {
    const folderId = t.getAttribute("data-folder");
    const folderName = t.getAttribute("data-fname");
    const ownerEmail = t.getAttribute("data-owner");
    
    showLoading("מצטרף לתיקייה...");
    
    // הוספה לתיקייה המשותפת
    const added = await addMemberToSharedFolder(folderId, myEmail, folderName, ownerEmail);
    
    if (added) {
      // עדכון סטטוס ההזמנה
      await updateInviteStatus(accId, "accepted");
      
      // עדכון מקומי
      if (!allUsersData[userNow].sharedFolders) {
        allUsersData[userNow].sharedFolders = {};
      }
      allUsersData[userNow].sharedFolders[folderId] = {
        name: folderName,
        owner: ownerEmail,
        members: [ownerEmail, myEmail]
      };
      saveAllUsersDataToStorage(allUsersData);
      {
  const acceptedEmail = myEmail;
  const folderId   = t.getAttribute("data-folder");
  const ownerEmail = (t.getAttribute("data-owner") || "").toLowerCase();

  const ownerName = findUsernameByEmail(allUsersData, ownerEmail) || ownerEmail;
  ensureUserSharedFields(allUsersData, ownerName);

  const ownerSF = allUsersData[ownerName].sharedFolders || {};
  if (!ownerSF[folderId]) ownerSF[folderId] = { name: t.getAttribute("data-fname") || "תיקייה משותפת", owner: ownerEmail, members: [] };
  const arr = ownerSF[folderId].members || (ownerSF[folderId].members = []);
  if (!arr.includes(acceptedEmail)) arr.push(acceptedEmail);

  allUsersData[ownerName].sharedFolders = ownerSF;
  saveAllUsersDataToStorage(allUsersData);

  if (categoryTitle.textContent === (ownerSF[folderId].name || "תיקייה משותפת")) {
    openSharedView();
  }
}
      showNotification("הצטרפת לתיקייה המשותפת ✔️");
    } else {
      showNotification("שגיאה בהצטרפות, נסי שוב", true);
    }
    
    hideLoading();
    await renderPending();
  }

  if (rejId) {
    showLoading("דוחה הזמנה...");
    await updateInviteStatus(rejId, "rejected");
    hideLoading();
    showNotification("ההזמנה נדחתה");
    await renderPending();
  }
});

// קריאה ראשונית
renderPending();
  homeView.classList.add("hidden");
  categoryView.classList.remove("hidden");
}



  function openRecycleView() {
    categoryTitle.textContent = "סל מחזור";
    const docs = allDocsData.filter(d => d._trashed === true);
    renderDocsList(docs, "recycle");
  }

  function markDocTrashed(id, trashed) {
    const i = allDocsData.findIndex(d => d.id === id);
    if (i > -1) {
      allDocsData[i]._trashed = !!trashed;
      setUserDocs(userNow, allDocsData, allUsersData);
      showNotification(trashed ? "הועבר לסל המחזור" : "שוחזר מהסל");
    }
  }

  function deleteDocForever(id) {
    const i = allDocsData.findIndex(d => d.id === id);
    if (i > -1) {
      // מוחקים גם את הקובץ עצמו מ-IndexedDB
      deleteFileFromDB(id).catch(() => {});
      allDocsData.splice(i, 1);
      setUserDocs(userNow, allDocsData, allUsersData);
      showNotification("הקובץ נמחק לצמיתות");
    }
  }

  function openEditModal(doc) {
    currentlyEditingDocId = doc.id;

    edit_title.value         = doc.title            || "";
    edit_org.value           = doc.org              || "";
    edit_year.value          = doc.year             || "";
    edit_recipient.value     = (doc.recipient || []).join(", ") || "";
    edit_warrantyStart.value = doc.warrantyStart    || "";
    edit_warrantyExp.value   = doc.warrantyExpiresAt|| "";
    edit_autoDelete.value    = doc.autoDeleteAfter  || "";
    edit_category.value      = doc.category         || "";
    edit_sharedWith.value    = (doc.sharedWith || []).join(", ") || "";

    editModal.classList.remove("hidden");
  }

  function closeEditModal() {
    currentlyEditingDocId = null;
    editModal.classList.add("hidden");
  }

  if (editCancelBtn) {
    editCancelBtn.addEventListener("click", () => {
      closeEditModal();
    });
  }

  if (editForm) {
    editForm.addEventListener("submit", (ev) => {
      ev.preventDefault();

      if (!currentlyEditingDocId) {
        closeEditModal();
        return;
      }

      const idx = allDocsData.findIndex(d => d.id === currentlyEditingDocId);
      if (idx === -1) {
        closeEditModal();
        return;
      }

      const updatedRecipients = edit_recipient.value
        .split(",")
        .map(s => s.trim())
        .filter(s => s !== "");

      const updatedShared = edit_sharedWith.value
        .split(",")
        .map(s => s.trim())
        .filter(s => s !== "");

      allDocsData[idx].title             = edit_title.value.trim() || allDocsData[idx].title;
      allDocsData[idx].org               = edit_org.value.trim();
      allDocsData[idx].year              = edit_year.value.trim();
      allDocsData[idx].recipient         = updatedRecipients;
      allDocsData[idx].warrantyStart     = edit_warrantyStart.value || "";
      allDocsData[idx].warrantyExpiresAt = edit_warrantyExp.value   || "";
      allDocsData[idx].autoDeleteAfter   = edit_autoDelete.value    || "";
      allDocsData[idx].category          = edit_category.value.trim() || "";
      allDocsData[idx].sharedWith        = updatedShared;

      setUserDocs(userNow, allDocsData, allUsersData);

      const currentCat = categoryTitle.textContent;
      if (currentCat === "אחסון משותף") {
        openSharedView();
      } else if (currentCat === "סל מחזור") {
        openRecycleView();
      } else {
        openCategoryView(currentCat);
      }

      showNotification("המסמך עודכן בהצלחה");
      closeEditModal();
    });
  }

  // ניווט
  window.App = {
    renderHome,
    openSharedView,
    openRecycleView
  };

  if (backButton) {
    backButton.addEventListener("click", () => {
      renderHome();
    });
  }

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener("click", () => {
      fileInput.click();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      const [field, dir] = sortSelect.value.split("-");
      currentSortField = field;
      currentSortDir   = dir;
      if (!categoryView.classList.contains("hidden")) {
        openCategoryView(categoryTitle.textContent);
      }
    });
  }

  // העלאת קובץ ושמירה (Metadata -> localStorage, קובץ -> IndexedDB)
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) {
        showNotification("❌ לא נבחר קובץ", true);
        return;
      }

      try {
        const fileName = file.name.trim();

        const alreadyExists = allDocsData.some(doc => {
          return (
            doc.originalFileName === fileName &&
            doc._trashed !== true
          );
        });
        if (alreadyExists) {
          showNotification("הקובץ הזה כבר קיים בארכיון שלך", true);
          fileInput.value = "";
          return;
        }

        // קטגוריה
        let guessedCategory = guessCategoryForFileNameOnly(file.name);
        if (!guessedCategory || guessedCategory === "אחר") {
          const manual = prompt(
            'לא זיהיתי אוטומטית את סוג המסמך.\nלאיזו תיקייה לשמור?\nאפשרויות: ' +
            CATEGORIES.join(", "),
            "רפואה"
          );
          if (manual && manual.trim() !== "") {
            guessedCategory = manual.trim();
          } else {
            guessedCategory = "אחר";
          }
        }

        // פרטי אחריות אם זה "אחריות"
        let warrantyStart = null;
        let warrantyExpiresAt = null;
        let autoDeleteAfter = null;

        if (guessedCategory === "אחריות") {
          let extracted = {
            warrantyStart: null,
            warrantyExpiresAt: null,
            autoDeleteAfter: null,
          };

          if (file.type === "application/pdf") {
            const ocrText = await extractTextFromPdfWithOcr(file);
            const dataFromText = extractWarrantyFromText(ocrText);
            extracted = { ...extracted, ...dataFromText };
          }

          if (file.type.startsWith("image/") && window.Tesseract) {
            const { data } = await window.Tesseract.recognize(file, "heb+eng", {
              tessedit_pageseg_mode: 6,
            });
            const imgText = data?.text || "";
            const dataFromText = extractWarrantyFromText(imgText);
            extracted = { ...extracted, ...dataFromText };
          }

          if (!extracted.warrantyStart && !extracted.warrantyExpiresAt) {
            const buf = await file.arrayBuffer().catch(() => null);
            if (buf) {
              const txt = new TextDecoder("utf-8").decode(buf);
              const dataFromText = extractWarrantyFromText(txt);
              extracted = { ...extracted, ...dataFromText };
            }
          }

          if (!extracted.warrantyStart && !extracted.warrantyExpiresAt) {
            const manualData = fallbackAskWarrantyDetails();
            if (manualData.warrantyStart) {
              extracted.warrantyStart = manualData.warrantyStart;
            }
            if (manualData.warrantyExpiresAt) {
              extracted.warrantyExpiresAt = manualData.warrantyExpiresAt;
            }
            if (manualData.autoDeleteAfter) {
              extracted.autoDeleteAfter = manualData.autoDeleteAfter;
            }
          }

          warrantyStart     = extracted.warrantyStart     || null;
          warrantyExpiresAt = extracted.warrantyExpiresAt || null;
          autoDeleteAfter   = extracted.autoDeleteAfter   || null;
        }

        // קוראות את הקובץ כ-base64 (dataURL)
        const fileDataBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(reader.result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // מזהה למסמך
        const newId = crypto.randomUUID();

        // שמירת הקובץ עצמו ב-IndexedDB (לא ב-localStorage)
        await saveFileToDB(newId, fileDataBase64);

        // נבנה אובייקט מסמך בלי לשמור את כל הבייס64
        const newDoc = {
          id: newId,
          title: fileName,
          originalFileName: fileName,
          category: guessedCategory,
          uploadedAt: new Date().toISOString().split("T")[0],
          year: new Date().getFullYear().toString(),
          org: "",
          recipient: [],
          sharedWith: [],

          warrantyStart,
          warrantyExpiresAt,
          autoDeleteAfter,

          mimeType: file.type,
          hasFile: true // יש קובץ שמור ב-IndexedDB
        };
allDocsData.push(newDoc);
setUserDocs(userNow, allDocsData, allUsersData);


// === Mirror to Firestore (owner document) ===
if (isFirebaseAvailable()) {
  try {
    const ownerEmail = normalizeEmail(getCurrentUserEmail() || userNow);
    const docRef = window.fs.doc(window.db, "documents", newId);

    // Write metadata only (do NOT store the base64)
    await window.fs.setDoc(docRef, {
      ...newDoc,
      owner: ownerEmail,
      // make sure we don't accidentally write any large dataURL fields
      fileDataBase64: undefined
    }, { merge: true });

    console.log("✅ Mirrored owner doc to Firestore:", newId);
  } catch (e) {
    console.error("❌ Firestore mirror failed:", e);
  }
}


// If this doc is in a shared folder, sync to Firestore immediately
if (newDoc.sharedFolderId && isFirebaseAvailable()) {
  console.log("🔄 New doc has sharedFolderId, syncing to Firestore...");
  try {
    await upsertSharedDocRecord(newDoc, newDoc.sharedFolderId);
  } catch (e) {
    console.error("Error syncing new doc to Firestore:", e);
  }
}

// ניסוח הודעה נחמה לפי התיקייה
let niceCat = guessedCategory && guessedCategory.trim()
  ? guessedCategory.trim()
  : "התיקייה";

showNotification(`הקובץ נוסף לתיקייה "${niceCat}" ✅`);

const currentCat = categoryTitle.textContent;
if (currentCat === "אחסון משותף") {
  openSharedView();
} else if (currentCat === "סל מחזור") {
  openRecycleView();
} else if (!homeView.classList.contains("hidden")) {
  renderHome();
} else {
  openCategoryView(currentCat);
}


        fileInput.value = "";

      } catch (err) {
        console.error("שגיאה בהעלאה:", err);
        showNotification("הייתה בעיה בהעלאה / OCR. נסי שוב או קובץ אחר.", true);
      }
    });
  }

  // פתיחת קובץ מה-IndexedDB
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-open-id]");
    if (!btn) return;

    const docId = btn.getAttribute("data-open-id");
    const docObj = allDocsData.find(d => d.id === docId);

    if (!docObj) {
      showNotification("לא נמצא המסמך", true);
      return;
    }

    // נטען את ה-dataURL מתוך IndexedDB
    let dataUrl = null;
    try {
      dataUrl = await loadFileFromDB(docObj.id);
    } catch (e) {
      console.error("שגיאה בשליפת קובץ מה-DB:", e);
    }

    if (!dataUrl) {
      showNotification("הקובץ הזה לא שמור / גדול מדי או נמחק מהמכשיר. אבל הפרטים נשמרו.", true);
      return;
    }

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = docObj.originalFileName || "file";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

try {
  if (getCurrentUserEmail() && isFirebaseAvailable()) {
    await bootFromCloud();  // initial load
    // watchMyDocs() is called by bootFromCloud(), no need to call twice
  }
} catch (e) {
  console.error("Failed to boot from cloud:", e);
}
});