export const createElement = (tag, classNames, content) => {
   let el = document.createElement(tag);
   if (classNames) el.className = classNames;
   if (content) el.innerHTML = content;
   return el;
};
