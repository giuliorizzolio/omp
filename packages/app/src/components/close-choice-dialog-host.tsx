import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { Check, Power } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  getDesktopHost,
  type DesktopCloseChoice,
  type DesktopCloseChoiceRequest,
} from "@/desktop/host";
import type { Theme } from "@/styles/theme";

const ThemedPower = withUnistyles(Power, (theme: Theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foregroundMuted,
}));
const ThemedCheck = withUnistyles(Check, (theme: Theme) => ({
  color: theme.colors.accentForeground,
}));
const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.45,
  },
  footerContent: {
    width: "100%",
    gap: theme.spacing[4],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  action: {
    minWidth: 64,
  },
  rememberRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: 0,
    paddingVertical: theme.spacing[1],
  },
  checkbox: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  checkboxChecked: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  rememberLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

function readCloseChoiceRequest(input: unknown): DesktopCloseChoiceRequest | null {
  if (!input || typeof input !== "object") return null;
  const requestId = (input as Partial<DesktopCloseChoiceRequest>).requestId;
  return Number.isSafeInteger(requestId) ? { requestId: requestId as number } : null;
}

export function CloseChoiceDialogHost() {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({ title: t("closeChoice.title"), leading: <ThemedPower /> }),
    [t],
  );
  const [request, setRequest] = useState<DesktopCloseChoiceRequest | null>(null);
  const [remember, setRemember] = useState(false);
  const [responding, setResponding] = useState(false);
  const requestIdRef = useRef<number | null>(null);

  const showRequest = useCallback((input: unknown) => {
    const nextRequest = readCloseChoiceRequest(input);
    if (!nextRequest || requestIdRef.current === nextRequest.requestId) return;
    requestIdRef.current = nextRequest.requestId;
    setRemember(false);
    setResponding(false);
    setRequest(nextRequest);
  }, []);

  useEffect(() => {
    const host = getDesktopHost();
    const closeChoice = host?.window?.closeChoice;
    const listen = host?.events?.on;
    if (!closeChoice || typeof listen !== "function") return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void Promise.resolve(listen("close-choice-request", showRequest)).then((cleanup) => {
      if (disposed) {
        cleanup?.();
        return null;
      }
      unlisten = cleanup;
      return null;
    });
    void closeChoice.ready?.().then((pendingRequest) => {
      if (!disposed && pendingRequest) showRequest(pendingRequest);
      return null;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [showRequest]);

  const respond = useCallback(
    async (choice: DesktopCloseChoice) => {
      if (!request || responding) return;
      const sendResponse = getDesktopHost()?.window?.closeChoice?.respond;
      if (!sendResponse) return;

      setResponding(true);
      try {
        const accepted = await sendResponse({ requestId: request.requestId, choice, remember });
        if (accepted) {
          requestIdRef.current = null;
          setRequest(null);
        }
      } catch (error) {
        console.error("[close choice] failed to send response", error);
      } finally {
        setResponding(false);
      }
    },
    [remember, request, responding],
  );
  const handleBackground = useCallback(() => void respond("background"), [respond]);
  const handleQuit = useCallback(() => void respond("quit"), [respond]);
  const handleCancel = useCallback(() => void respond("cancel"), [respond]);
  const handleRemember = useCallback(() => setRemember((current) => !current), []);
  const rememberState = useMemo(
    () => ({ checked: remember, disabled: responding }),
    [remember, responding],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footerContent}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={rememberState}
          disabled={responding}
          onPress={handleRemember}
          style={styles.rememberRow}
          testID="close-choice-remember"
        >
          <View style={[styles.checkbox, remember ? styles.checkboxChecked : null]}>
            {remember ? <ThemedCheck size={13} /> : null}
          </View>
          <Text style={styles.rememberLabel}>{t("closeChoice.remember")}</Text>
        </Pressable>
        <View style={styles.actions}>
          <Button
            style={styles.action}
            size="sm"
            variant="ghost"
            disabled={responding}
            onPress={handleCancel}
            testID="close-choice-cancel"
          >
            {t("closeChoice.cancel")}
          </Button>
          <Button
            style={styles.action}
            size="sm"
            variant="outline"
            disabled={responding}
            onPress={handleQuit}
            testID="close-choice-quit"
          >
            {t("closeChoice.quit")}
          </Button>
          <Button
            style={styles.action}
            size="sm"
            variant="default"
            disabled={responding}
            onPress={handleBackground}
            testID="close-choice-background"
          >
            {t("closeChoice.background")}
          </Button>
        </View>
      </View>
    ),
    [
      remember,
      responding,
      rememberState,
      handleBackground,
      handleQuit,
      handleCancel,
      handleRemember,
      t,
    ],
  );

  return (
    <AdaptiveModalSheet
      visible={request !== null}
      header={header}
      onClose={handleCancel}
      footer={footer}
      desktopMaxWidth={400}
      density="compact"
      snapPoints={["42%"]}
      scrollable={false}
      testID="close-choice-dialog"
    >
      <Text style={styles.message}>{t("closeChoice.message")}</Text>
    </AdaptiveModalSheet>
  );
}
