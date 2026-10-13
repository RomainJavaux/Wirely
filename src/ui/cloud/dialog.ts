export interface Dialog {
  el: HTMLDialogElement;
  close(): void;
}

/** Boîte de dialogue modale native (<dialog>) : focus piégé et Échap gérés par le navigateur. */
export function openDialog(html: string, className = ''): Dialog {
  const el = document.createElement('dialog');
  el.className = `dlg ${className}`.trim();
  el.innerHTML = html;
  document.body.appendChild(el);
  el.addEventListener('close', () => el.remove());
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close(); // clic sur le fond
  });
  el.showModal();
  return {
    el,
    close: () => {
      if (el.open) el.close();
      el.remove(); // sans attendre l'événement « close »
    },
  };
}
