import { useState, useEffect, useCallback } from "react";
import { Preferences } from "@capacitor/preferences";
import { supabase } from "@/integrations/supabase/client";

export interface SavedAccount {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  profileImageUrl?: string;
  refreshToken?: string;
  lastUsed: number;
}

const ACCOUNTS_KEY = "pasify_saved_accounts";
const ACTIVE_ACCOUNT_KEY = "pasify_active_account";

export const useMultiAccount = () => {
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);

  // Carica gli account salvati all'avvio
  useEffect(() => {
    loadSavedAccounts();
  }, []);

  const loadSavedAccounts = async () => {
    try {
      const { value: accountsJson } = await Preferences.get({ key: ACCOUNTS_KEY });
      const { value: activeId } = await Preferences.get({ key: ACTIVE_ACCOUNT_KEY });

      console.log("[MultiAccount] Loading accounts from storage...");

      if (accountsJson) {
        const accounts = JSON.parse(accountsJson) as SavedAccount[];
        console.log("[MultiAccount] Found", accounts.length, "saved accounts:", accounts.map(a => ({ email: a.email, hasToken: !!a.refreshToken })));
        setSavedAccounts(accounts);
      } else {
        console.log("[MultiAccount] No saved accounts found in storage");
      }

      if (activeId) {
        console.log("[MultiAccount] Active account ID:", activeId);
        setActiveAccountId(activeId);
      }
    } catch (error) {
      console.error("[MultiAccount] Error loading saved accounts:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveAccountsToStorage = async (accounts: SavedAccount[]): Promise<void> => {
    try {
      console.log("[MultiAccount] Saving accounts to storage...", accounts.length);
      await Preferences.set({
        key: ACCOUNTS_KEY,
        value: JSON.stringify(accounts),
      });
      console.log("[MultiAccount] Accounts saved to storage successfully");
    } catch (error) {
      console.error("Error saving accounts:", error);
    }
  };

  const setActiveAccount = async (accountId: string) => {
    try {
      await Preferences.set({
        key: ACTIVE_ACCOUNT_KEY,
        value: accountId,
      });
      setActiveAccountId(accountId);
    } catch (error) {
      console.error("Error setting active account:", error);
    }
  };

  // Salva l'account corrente con il refresh token
  const saveCurrentAccount = useCallback(async (profile: any) => {
    if (!profile?.id) return;

    // Ottieni la sessione corrente per il refresh token
    const { data: { session } } = await supabase.auth.getSession();

    console.log("[MultiAccount] Saving account:", profile.id, "Has refresh token:", !!session?.refresh_token);

    const newAccount: SavedAccount = {
      id: profile.id,
      email: profile.email || "",
      firstName: profile.first_name,
      lastName: profile.last_name,
      businessName: profile.business_name,
      profileImageUrl: profile.profile_image_url,
      refreshToken: session?.refresh_token,
      lastUsed: Date.now(),
    };

    // Leggi gli account correnti direttamente dallo storage per evitare race conditions
    const { value: accountsJson } = await Preferences.get({ key: ACCOUNTS_KEY });
    let currentAccounts: SavedAccount[] = [];
    if (accountsJson) {
      currentAccounts = JSON.parse(accountsJson);
    }

    // Filtra e aggiorna
    const filtered = currentAccounts.filter((acc) => acc.id !== profile.id);
    const updated = [newAccount, ...filtered];

    // Salva nello storage e aspetta il completamento
    await saveAccountsToStorage(updated);
    console.log("[MultiAccount] Total saved accounts:", updated.length);

    // Aggiorna lo state locale
    setSavedAccounts(updated);

    await setActiveAccount(profile.id);
  }, []);

  // Aggiorna i dati di un account esistente (incluso refresh token)
  const updateAccountData = useCallback(async (profile: any) => {
    if (!profile?.id) return;

    const { data: { session } } = await supabase.auth.getSession();

    // Leggi gli account correnti direttamente dallo storage
    const { value: accountsJson } = await Preferences.get({ key: ACCOUNTS_KEY });
    let currentAccounts: SavedAccount[] = [];
    if (accountsJson) {
      currentAccounts = JSON.parse(accountsJson);
    }

    const updated = currentAccounts.map((acc) =>
      acc.id === profile.id
        ? {
            ...acc,
            firstName: profile.first_name,
            lastName: profile.last_name,
            businessName: profile.business_name,
            profileImageUrl: profile.profile_image_url,
            refreshToken: session?.refresh_token || acc.refreshToken,
            lastUsed: Date.now(),
          }
        : acc
    );

    // Salva nello storage e aspetta il completamento
    await saveAccountsToStorage(updated);

    // Aggiorna lo state locale
    setSavedAccounts(updated);
  }, []);

  // Switch ad un altro account usando il refresh token
  const switchToAccount = useCallback(async (account: SavedAccount): Promise<boolean> => {
    console.log("[MultiAccount] Attempting switch to:", account.email, "Has token:", !!account.refreshToken);

    if (!account.refreshToken) {
      console.log("[MultiAccount] No refresh token, need manual login");
      return false;
    }

    setIsSwitching(true);

    try {
      // Usa il refresh token per ottenere una nuova sessione
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: account.refreshToken,
      });

      if (error || !data.session) {
        console.error("[MultiAccount] Error refreshing session:", error);
        // Token scaduto o invalido, richiedi login manuale
        // Non rimuoviamo l'account, potrebbe essere un errore temporaneo
        return false;
      }

      console.log("[MultiAccount] Session refreshed successfully, new token obtained");

      // Aggiorna il refresh token salvato DIRETTAMENTE nello storage (non tramite state)
      // Questo garantisce che il salvataggio avvenga prima del reload
      const { value: accountsJson } = await Preferences.get({ key: ACCOUNTS_KEY });
      let currentAccounts: SavedAccount[] = [];
      if (accountsJson) {
        currentAccounts = JSON.parse(accountsJson);
      }

      const updatedAccounts = currentAccounts.map((acc) =>
        acc.id === account.id
          ? { ...acc, refreshToken: data.session?.refresh_token, lastUsed: Date.now() }
          : acc
      );

      // Salva direttamente nello storage e aspetta il completamento
      await Preferences.set({
        key: ACCOUNTS_KEY,
        value: JSON.stringify(updatedAccounts),
      });
      console.log("[MultiAccount] Updated accounts saved to storage");

      // Imposta l'account attivo e aspetta il completamento
      await Preferences.set({
        key: ACTIVE_ACCOUNT_KEY,
        value: account.id,
      });
      console.log("[MultiAccount] Active account set to:", account.id);

      // Piccolo delay per assicurarsi che lo storage sia sincronizzato
      await new Promise(resolve => setTimeout(resolve, 100));

      // Ricarica la pagina per applicare il nuovo utente
      window.location.reload();

      return true;
    } catch (error) {
      console.error("[MultiAccount] Error switching account:", error);
      return false;
    } finally {
      setIsSwitching(false);
    }
  }, []);

  // Rimuovi un account dalla lista
  const removeAccount = useCallback(async (accountId: string) => {
    // Leggi gli account correnti direttamente dallo storage
    const { value: accountsJson } = await Preferences.get({ key: ACCOUNTS_KEY });
    let currentAccounts: SavedAccount[] = [];
    if (accountsJson) {
      currentAccounts = JSON.parse(accountsJson);
    }

    const updated = currentAccounts.filter((acc) => acc.id !== accountId);

    // Salva nello storage e aspetta il completamento
    await saveAccountsToStorage(updated);

    // Aggiorna lo state locale
    setSavedAccounts(updated);

    if (activeAccountId === accountId) {
      await Preferences.remove({ key: ACTIVE_ACCOUNT_KEY });
      setActiveAccountId(null);
    }
  }, [activeAccountId]);

  // Aggiungi nuovo account (redirect al login)
  const addNewAccount = useCallback(async () => {
    // NON fare logout - salva la sessione corrente e vai al login
    return true;
  }, []);

  const getDisplayName = (account: SavedAccount) => {
    if (account.firstName) {
      return `${account.firstName} ${account.lastName || ""}`.trim();
    }
    return account.businessName || account.email || "Account";
  };

  return {
    savedAccounts,
    activeAccountId,
    isLoading,
    isSwitching,
    saveCurrentAccount,
    updateAccountData,
    switchToAccount,
    removeAccount,
    addNewAccount,
    getDisplayName,
  };
};