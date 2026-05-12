import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, Plus, X, Settings, User, Loader2, Eye, EyeOff, Trash2, CreditCard } from "lucide-react";
import { useMultiAccount, SavedAccount } from "@/hooks/useMultiAccount";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface AccountSwitcherSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProfile: any;
  onOpenSettings?: () => void;
  onOpenSubscription?: () => void;
}

const AccountSwitcherSheet = ({
  open,
  onOpenChange,
  currentProfile,
  onOpenSettings,
  onOpenSubscription,
}: AccountSwitcherSheetProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const {
    savedAccounts,
    activeAccountId,
    isSwitching,
    switchToAccount,
    removeAccount,
    getDisplayName,
  } = useMultiAccount();

  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);
  const [accountNeedingPassword, setAccountNeedingPassword] = useState<SavedAccount | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [longPressedId, setLongPressedId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback((accountId: string) => {
    longPressTimer.current = setTimeout(() => {
      setLongPressedId(accountId);
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleSwitchAccount = async (account: SavedAccount) => {
    if (account.id === activeAccountId) {
      onOpenChange(false);
      return;
    }

    setSwitchingAccountId(account.id);

    const success = await switchToAccount(account);

    if (!success) {
      // Token scaduto, mostra il campo password
      setAccountNeedingPassword(account);
      setPassword("");
    }

    setSwitchingAccountId(null);
  };

  const handlePasswordLogin = async () => {
    if (!accountNeedingPassword || !password) return;

    setIsLoggingIn(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: accountNeedingPassword.email,
        password: password,
      });

      if (error) {
        toast({
          title: t("common.error"),
          description: t("accountSwitcher.wrongPassword"),
          variant: "destructive",
        });
        setIsLoggingIn(false);
        return;
      }

      // Login riuscito, la pagina si ricaricherà automaticamente
      toast({
        title: t("accountSwitcher.loginSuccess"),
        description: `${t("accountSwitcher.welcome")} ${getDisplayName(accountNeedingPassword)}`,
      });

      setAccountNeedingPassword(null);
      setPassword("");
      onOpenChange(false);

      // Ricarica per applicare la nuova sessione
      window.location.reload();
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: t("common.error"),
        description: t("accountSwitcher.errorOccurred"),
        variant: "destructive",
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleCancelPasswordLogin = () => {
    setAccountNeedingPassword(null);
    setPassword("");
  };

  const handleAddAccount = () => {
    onOpenChange(false);
    navigate("/login", { state: { addingAccount: true } });
  };

  const handleRemoveAccount = async (accountId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (accountId === activeAccountId) {
      toast({
        title: t("accountSwitcher.cannotRemoveActive"),
        description: t("accountSwitcher.switchFirst"),
      });
      return;
    }
    await removeAccount(accountId);
    toast({
      title: t("accountSwitcher.accountRemoved"),
    });
  };

  const getInitials = (account: SavedAccount) => {
    if (account.firstName) {
      return account.firstName[0].toUpperCase();
    }
    if (account.businessName) {
      return account.businessName[0].toUpperCase();
    }
    return account.email?.[0]?.toUpperCase() || "?";
  };

  // Ordina: account attivo prima, poi per lastUsed
  const sortedAccounts = [...savedAccounts].sort((a, b) => {
    if (a.id === activeAccountId) return -1;
    if (b.id === activeAccountId) return 1;
    return b.lastUsed - a.lastUsed;
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={() => onOpenChange(false)}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh]"
          >
            <div className="bg-white dark:bg-gray-900 rounded-t-[24px] shadow-2xl overflow-hidden">
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full" />
              </div>

              {/* Header - Stile Instagram */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      if (accountNeedingPassword) {
                        handleCancelPasswordLogin();
                      } else {
                        onOpenChange(false);
                      }
                    }}
                    className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                  </button>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                    {accountNeedingPassword ? t("accountSwitcher.enterPassword") : t("accountSwitcher.title")}
                  </h2>
                  <div className="w-9" />
                </div>
              </div>

              {/* Password Input View */}
              {accountNeedingPassword ? (
                <div className="px-4 py-6">
                  {/* Account Info */}
                  <div className="flex items-center gap-3 mb-6">
                    <Avatar className="h-14 w-14">
                      <AvatarImage src={accountNeedingPassword.profileImageUrl} />
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-semibold">
                        {getInitials(accountNeedingPassword)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {getDisplayName(accountNeedingPassword)}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {accountNeedingPassword.email}
                      </p>
                    </div>
                  </div>

                  {/* Password Input */}
                  <div className="space-y-4">
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handlePasswordLogin()}
                        className="pr-10 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 border-0"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? (
                          <EyeOff className="w-5 h-5" />
                        ) : (
                          <Eye className="w-5 h-5" />
                        )}
                      </button>
                    </div>

                    <Button
                      onClick={handlePasswordLogin}
                      disabled={!password || isLoggingIn}
                      className="w-full h-12 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold"
                    >
                      {isLoggingIn ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        t("accountSwitcher.login")
                      )}
                    </Button>

                    <button
                      onClick={handleCancelPasswordLogin}
                      className="w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                /* Account List - Stile Instagram */
                <div className="max-h-[50vh] overflow-y-auto">
                  {sortedAccounts.map((account, index) => {
                    const isActive = account.id === activeAccountId;
                    const isCurrentlySwitching = switchingAccountId === account.id;
                    const isLongPressed = longPressedId === account.id;

                    return (
                      <motion.div
                        key={account.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <AnimatePresence mode="wait">
                          {isLongPressed && !isActive ? (
                            <motion.div
                              key="delete"
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              className="flex items-center gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/20"
                            >
                              <Avatar className="h-12 w-12">
                                <AvatarImage src={account.profileImageUrl} />
                                <AvatarFallback className="font-semibold text-white bg-gradient-to-br from-gray-400 to-gray-500">
                                  {getInitials(account)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 text-left min-w-0">
                                <p className="font-semibold truncate text-gray-900 dark:text-white">
                                  {getDisplayName(account)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setLongPressedId(null)}
                                  className="p-2 rounded-full bg-gray-200 dark:bg-gray-700"
                                >
                                  <X className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    handleRemoveAccount(account.id, e);
                                    setLongPressedId(null);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-red-500 text-white text-sm font-medium"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  {t("accountSwitcher.removeAccount")}
                                </button>
                              </div>
                            </motion.div>
                          ) : (
                            <motion.button
                              key="card"
                              onClick={() => {
                                if (longPressedId) {
                                  setLongPressedId(null);
                                  return;
                                }
                                handleSwitchAccount(account);
                              }}
                              disabled={isSwitching}
                              onTouchStart={() => handleTouchStart(account.id)}
                              onTouchEnd={handleTouchEnd}
                              onTouchMove={handleTouchEnd}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (!isActive) setLongPressedId(account.id);
                              }}
                              className={`
                                w-full flex items-center gap-3 px-4 py-3
                                hover:bg-gray-50 dark:hover:bg-gray-800
                                active:bg-gray-100 dark:active:bg-gray-700
                                transition-colors disabled:opacity-50
                                ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
                              `}
                            >
                              {/* Avatar */}
                              <div className="relative">
                                <Avatar className={`h-12 w-12 ${isActive ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}>
                                  <AvatarImage src={account.profileImageUrl} />
                                  <AvatarFallback className={`
                                    font-semibold text-white
                                    ${isActive
                                      ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                                      : 'bg-gradient-to-br from-gray-400 to-gray-500'
                                    }
                                  `}>
                                    {getInitials(account)}
                                  </AvatarFallback>
                                </Avatar>

                                {/* Badge check per account attivo */}
                                {isActive && (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center border-2 border-white dark:border-gray-900"
                                  >
                                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                                  </motion.div>
                                )}
                              </div>

                              {/* Info */}
                              <div className="flex-1 text-left min-w-0">
                                <p className={`font-semibold truncate ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
                                  {getDisplayName(account)}
                                </p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                  {account.email}
                                </p>
                              </div>

                              {/* Status */}
                              <div className="flex items-center gap-2">
                                {isCurrentlySwitching ? (
                                  <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                                ) : isActive ? (
                                  <span className="text-xs font-medium text-blue-500 bg-blue-100 dark:bg-blue-900/30 px-2 py-1 rounded-full">
                                    {t("accountSwitcher.active")}
                                  </span>
                                ) : null}
                              </div>
                            </motion.button>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Actions - Hide when password input is shown */}
              {!accountNeedingPassword && (
                <div className="border-t border-gray-100 dark:border-gray-800">
                  {/* Aggiungi account */}
                  <button
                    onClick={handleAddAccount}
                    className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                      <Plus className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {t("accountSwitcher.addAccount")}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("accountSwitcher.addAccountDesc")}
                      </p>
                    </div>
                  </button>

                  {/* Gestiona suscripción (solo partner) */}
                  {onOpenSubscription && (
                    <button
                      onClick={() => {
                        onOpenChange(false);
                        onOpenSubscription();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-t border-gray-100 dark:border-gray-800"
                    >
                      <div className="w-12 h-12 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
                        <CreditCard className="w-6 h-6 text-sky-600 dark:text-sky-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-semibold text-gray-900 dark:text-white">
                          Gestiona suscripción
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Estado, facturas y pago
                        </p>
                      </div>
                    </button>
                  )}

                  {/* Impostazioni */}
                  {onOpenSettings && (
                    <button
                      onClick={() => {
                        onOpenChange(false);
                        onOpenSettings();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-t border-gray-100 dark:border-gray-800"
                    >
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <Settings className="w-6 h-6 text-gray-600 dark:text-gray-300" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {t("accountSwitcher.settings")}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {t("accountSwitcher.settingsDesc")}
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              )}

              {/* Safe area */}
              <div className="h-8" />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AccountSwitcherSheet;