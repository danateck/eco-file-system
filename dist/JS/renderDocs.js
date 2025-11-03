// JS/renderDocs.js
import { createElement } from "./utils/createElement.js";
import { buildTagListForDoc } from "./utils/helper.js";

export const renderDocs = (docData, activeFilters, rerenderFilters, parentContainer) => {
    const cardHTML = `
        <div class="job-listing-card__details">
            <div class="company-details">
                <p class="company-name">
                    <span class="name text-primary-green">${docData.title}</span>
                </p>
                <h1 class="position text-green-900">${docData.org}</h1>
                <ul>
                    <li class="postedAt">שנה: ${docData.year}</li>
                    <li class="contract">מי שייך: ${docData.recipient.join(", ")}</li>
                    <li class="location">תאריך העלאה: ${docData.uploadedAt}</li>
                </ul>
            </div>
            <div class="company-logo" style="margin-inline-start:auto;">
                <a class="open-file-btn"
                   href="${docData.fileUrl}"
                   target="_self"
                   rel="noopener noreferrer"
                   style="font-size:0.9rem; font-weight:600; color:#0e3535; text-decoration:underline;">
                    פתיחת קובץ
                </a>
            </div>
        </div>
        <hr>
        <div class="job-listing-card__filter"></div>
    `;

    const cardEl = createElement("div", "job-listing-card", cardHTML);
    parentContainer.appendChild(cardEl);

    // אזור תגיות
    const tagsContainer = createElement("div", "filter-list-container");
    cardEl.appendChild(tagsContainer);

    const tagList = buildTagListForDoc(docData);

    tagList.forEach(tag => {
        const tagEl = createElement("p", "skills", tag);
        tagsContainer.appendChild(tagEl);
    });

    // להוסיף פילטר כשנלחץ על תגית
    tagsContainer.addEventListener("click", (e) => {
        if (e.target.classList.contains("skills")) {
            const clickedTag = e.target.textContent.trim();
            activeFilters.push(clickedTag);
            rerenderFilters();
        }
    });

    return cardEl;
};
