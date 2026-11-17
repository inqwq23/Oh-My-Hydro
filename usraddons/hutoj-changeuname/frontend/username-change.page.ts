import { $, addPage, AutoloadPage, Dialog, selectUser } from '@hydrooj/ui-default';
import './username-change.page.css';

interface AvailabilityResult {
    available: boolean;
    reason?: 'available' | 'empty' | 'invalid' | 'taken' | 'unchanged';
}

interface SelectedUser {
    _id: number;
    uname: string;
}

interface AvailabilityOptions {
    targetInput?: HTMLInputElement;
}

function createAvailableIcon(input: HTMLInputElement) {
    const container = input.closest('.textbox-container');
    if (!container) return null;
    const icon = document.createElement('span');
    icon.className = 'username-availability-icon icon icon-check--circle';
    icon.setAttribute('aria-hidden', 'true');
    container.append(icon);
    return icon;
}

function initAvailability(root: HTMLElement, options: AvailabilityOptions = {}) {
    const form = root.querySelector<HTMLFormElement>('form');
    const input = root.querySelector<HTMLInputElement>('input[name="uname"]');
    const status = root.querySelector<HTMLElement>('[data-username-availability]');
    const submit = root.querySelector<HTMLInputElement>('input[type="submit"]');
    if (!form || !input || !status || !submit || input.disabled) return null;

    const icon = createAvailableIcon(input);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let requestSequence = 0;
    let verifiedUsername = '';
    let verifiedTarget = '';

    const targetValue = () => options.targetInput?.value.trim() || '';
    const targetReady = () => !options.targetInput || Boolean(targetValue());
    const setState = (message = '', available = false) => {
        status.textContent = message;
        status.hidden = !message;
        status.style.color = message ? '#d33' : '';
        icon?.classList.toggle('is-visible', available);
        input.classList.toggle('has-available-icon', available);
        submit.disabled = !(available && targetReady());
        if (!available) {
            verifiedUsername = '';
            verifiedTarget = '';
        }
    };
    const isVerified = () => (
        verifiedUsername === input.value.trim()
        && verifiedTarget === targetValue()
        && targetReady()
    );

    const scheduleCheck = (showEmpty = true) => {
        if (timer) clearTimeout(timer);
        controller?.abort();
        controller = undefined;
        requestSequence += 1;
        const sequence = requestSequence;
        const uname = input.value.trim();
        const target = targetValue();

        setState();
        if (!targetReady()) return;
        if (!uname) {
            if (showEmpty) setState(root.dataset.textEmpty);
            return;
        }
        if (uname === root.dataset.currentUsername) {
            setState(root.dataset.textUnchanged);
            return;
        }

        // Keep the intermediate state intentionally silent. The disabled submit
        // button communicates that validation has not completed yet.
        timer = setTimeout(async () => {
            controller = new AbortController();
            const url = new URL(root.dataset.checkUrl!, window.location.origin);
            url.searchParams.set('uname', uname);
            if (target) url.searchParams.set('target', target);
            try {
                const response = await fetch(url, {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json() as AvailabilityResult;
                if (sequence !== requestSequence) return;
                if (result.available) {
                    verifiedUsername = uname;
                    verifiedTarget = target;
                    setState('', true);
                } else if (result.reason === 'empty') {
                    setState(root.dataset.textEmpty);
                } else if (result.reason === 'invalid') {
                    setState(root.dataset.textInvalid);
                } else if (result.reason === 'unchanged') {
                    setState(root.dataset.textUnchanged);
                } else {
                    setState(root.dataset.textTaken);
                }
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                if (sequence === requestSequence) setState(root.dataset.textError);
            }
        }, 300);
    };

    input.addEventListener('input', () => scheduleCheck());
    form.addEventListener('submit', (event) => {
        if (!isVerified()) event.preventDefault();
    });
    setState();
    return { form, isVerified, scheduleCheck };
}

async function confirmUsernameChange(root: HTMLElement) {
    const $body = $('<div class="typo"><p></p></div>');
    $body.find('p').text(root.dataset.confirmMessage || '');
    const $cancel = $('<button type="button" class="rounded button" data-action="cancel"></button>')
        .text(root.dataset.cancelLabel || 'Cancel');
    const $confirm = $('<button type="button" class="primary rounded button" data-action="confirm"></button>')
        .text(root.dataset.confirmLabel || 'Confirm');
    const result = await new Dialog({
        $body,
        $action: $cancel.add($confirm),
        cancelByClickingBack: true,
        cancelByEsc: true,
    }).open();
    return result === 'confirm';
}

function initHomeUsernameChange() {
    const root = document.getElementById('change_username');
    if (!root || root.dataset.usernameChangeInitialized) return;
    root.dataset.usernameChangeInitialized = 'true';
    const availability = initAvailability(root);
    if (!availability || root.dataset.requiresConfirmation !== 'true') return;

    let confirmationOpen = false;
    availability.form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!availability.isVerified() || confirmationOpen) return;
        confirmationOpen = true;
        try {
            if (await confirmUsernameChange(root)) {
                HTMLFormElement.prototype.submit.call(availability.form);
            }
        } finally {
            confirmationOpen = false;
        }
    });
}

function initManageUsernameChange() {
    const root = document.getElementById('manage_username_change');
    if (!root || root.dataset.usernameChangeInitialized) return;
    root.dataset.usernameChangeInitialized = 'true';
    const targetInput = root.querySelector<HTMLInputElement>('input[name="target"]');
    const selectButton = root.querySelector<HTMLButtonElement>('[data-select-target-user]');
    const selectedLabel = root.querySelector<HTMLElement>('[data-selected-target-user]');
    if (!targetInput || !selectButton || !selectedLabel) return;

    const availability = initAvailability(root, { targetInput });
    if (!availability) return;
    selectButton.addEventListener('click', async () => {
        const user = await selectUser() as SelectedUser | null;
        if (!user) return;
        targetInput.value = String(user._id);
        selectedLabel.textContent = `${user.uname} (UID: ${user._id})`;
        availability.scheduleCheck(false);
    });
}

addPage(new AutoloadPage('hutoj-username-change', () => {
    initHomeUsernameChange();
    initManageUsernameChange();
}));
