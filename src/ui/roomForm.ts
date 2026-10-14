import { addRoomQuick, defaultRoomSize } from '../core/planActions';
import type { Store } from '../core/store';
import { ROOM_KIND_IDS, ROOM_KINDS } from '../domain/plan/roomKinds';
import type { RoomKind } from '../domain/types';
import { esc } from '../util/escape';
import { qs } from './dom';

/**
 * « Ajouter une pièce » : type, nom et dimensions saisis au clavier. La pièce se colle à la
 * sélection ; le formulaire reste ouvert pour enchaîner les pièces d'un logement en une minute.
 */
export class RoomForm {
  private readonly button = qs<HTMLButtonElement>('#addRoomBtn');
  private readonly form = qs<HTMLFormElement>('#roomForm');
  private readonly kind = qs<HTMLSelectElement>('#rfKind');
  private readonly name = qs<HTMLInputElement>('#rfName');
  private readonly width = qs<HTMLInputElement>('#rfW');
  private readonly depth = qs<HTMLInputElement>('#rfD');

  constructor(private readonly store: Store) {
    this.kind.innerHTML = ROOM_KIND_IDS.filter((id) => id !== 'autre')
      .map((id) => `<option value="${id}">${esc(ROOM_KINDS[id].name)}</option>`)
      .join('');
    this.kind.value = 'sejour';
    this.applyDefaults();

    this.button.onclick = () => (this.form.hidden ? this.open() : this.close());
    qs<HTMLButtonElement>('#rfClose').onclick = () => this.close();
    this.kind.onchange = () => this.applyDefaults();
    this.form.onsubmit = (e) => {
      e.preventDefault();
      this.submit();
    };
    document.addEventListener('wirely:add-room', () => this.open());
    qs<HTMLButtonElement>('#startRoom').onclick = () => this.open();
  }

  open(): void {
    // Le formulaire vit dans le panneau du plan.
    if (this.store.state.mode !== 'plan') this.store.change((s) => (s.mode = 'plan'));
    this.form.hidden = false;
    this.button.classList.add('active');
    this.kind.focus();
  }

  close(): void {
    this.form.hidden = true;
    this.button.classList.remove('active');
  }

  /** Dimensions et nom proposés selon le type choisi. */
  private applyDefaults(): void {
    const kind = this.kind.value as RoomKind;
    const [w, d] = defaultRoomSize(kind);
    this.width.value = String(w);
    this.depth.value = String(d);
    this.name.placeholder = ROOM_KINDS[kind].name;
  }

  private submit(): void {
    const kind = this.kind.value as RoomKind;
    const widthM = Number(this.width.value.replace(',', '.'));
    const depthM = Number(this.depth.value.replace(',', '.'));
    const sel = this.store.selectedItem;
    const id = addRoomQuick(this.store, {
      kind,
      name: this.name.value.trim() || ROOM_KINDS[kind].name,
      widthM,
      depthM,
      nearId: sel?.type === 'room' ? sel.id : null,
    });
    if (id === null) {
      this.width.focus();
      return;
    }
    // La suite : même formulaire, nom vidé, type suivant le plus probable laissé tel quel.
    this.name.value = '';
    this.applyDefaults();
    this.kind.focus();
    document.dispatchEvent(new CustomEvent('wirely:fit-plan'));
  }
}
