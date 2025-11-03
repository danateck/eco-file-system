// JS/utils/helper.js
export const buildTagListForDoc = (doc) => {
  return [
    doc.org,
    String(doc.year),
    ...doc.recipient,
    ...doc.category
  ];
};
