// authCheck.js
// Place this file in pages/login/ folder and include it in index.html

// Check if user is logged in
function isUserLoggedIn() {
    const currentUser = sessionStorage.getItem("docArchiveCurrentUser");
    console.log("Checking login status. Current user:", currentUser);
    return currentUser !== null && currentUser !== "";
}

// Get current logged in user email
function getCurrentUserEmail() {
    return sessionStorage.getItem("docArchiveCurrentUser");
}

// Logout function
function logoutUser() {
    sessionStorage.removeItem("docArchiveCurrentUser");
    sessionStorage.removeItem("loginSuccess");
    console.log("User logged out");
    // Redirect to login page (index.html in forms/eco-wellness/)
    window.location.href = "./forms/eco-wellness/index.html";
}

// For LOGIN PAGE: Redirect to home if already logged in
function redirectIfLoggedIn() {
    // Only redirect if login was successful (not during a failed attempt)
    const loginSuccess = sessionStorage.getItem("loginSuccess");
    if (isUserLoggedIn() && loginSuccess === "true") {
        console.log("User already logged in, redirecting to home...");
        sessionStorage.removeItem("loginSuccess"); // Clear the flag
        window.location.replace("../../index.html");
        return true;
    }
    return false;
}

// For HOME PAGE: Redirect to login if NOT logged in
function requireLogin() {
    console.log("requireLogin called");
    if (!isUserLoggedIn()) {
        console.log("User not logged in, redirecting to login page...");
        // Path from project/index.html to forms/eco-wellness/index.html
        window.location.replace("./forms/eco-wellness/index.html");
        return false;
    }
    // Clear the login success flag once we're on home page
    sessionStorage.removeItem("loginSuccess");
    console.log("User is logged in:", getCurrentUserEmail());
    return true;
}

console.log("authCheck.js loaded. Current user:", getCurrentUserEmail());