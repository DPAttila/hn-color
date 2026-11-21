async function userNameToColor(userName) {
  const hashBuffer = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(userName));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // Note: each term needs explicit parentheses. `+` binds tighter than `|`,
  // so without them the two halves would be added before being ORed, which
  // silently drops most of the color bits.
  const hash = ((hashArray[0] % 16) << 20) | ((hashArray[1] % 16) << 12) | ((hashArray[2] % 16) << 4)
             + ((hashArray[0] / 16) << 16) | ((hashArray[1] / 16) << 8) | (hashArray[2] / 16);

  return '#' + hash.toString(16).padStart(6, '0');
}

function setColorRecursive(elem, color) {
  if (!elem ) {
    return;
  }

  elem.style.color = color;
  for (const child of elem.children) {
    setColorRecursive(child, color);
  }
}

window.addEventListener('load', function () {
  // HN renders comment authors as <span class="comhead"><a href="user?id=NAME">NAME</a> ...</span>.
  // (Older pages used <a class="hnuser">; support both.) The story author's
  // link lives in a .subline, so it is excluded.
  const users = document.querySelectorAll('.comhead > a[href^="user?id="], a.hnuser');

  users.forEach(async (user) => {
    // innerText is the browser-native way to read rendered text; fall
    // back to textContent for non-layout engines (e.g. jsdom in tests).
    const userName = user.innerText ?? user.textContent;
    const color = await userNameToColor(userName);

    // user -> span.comhead -> header div -> <td class="default">.
    // The <td> contains the whole comment (header + body + reply link) but
    // not the nested replies, which live in sibling <tr> rows.
    const parent = user.parentElement;        // span.comhead (header row)
    const row = parent.parentElement.parentElement; // <td class="default">

    parent.style.backgroundColor = color;
    row.style.border = '1px solid ' + color;
    row.style.borderRadius = '5px';
    row.style.padding = '2px';
    user.style.backgroundColor = 'black';
    setColorRecursive(parent, 'white');
  });
});
