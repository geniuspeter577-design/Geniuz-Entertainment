export type ConfirmActionOptions = {
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

type ConfirmRuntime = {
  platform: string;
  webConfirm: (message: string) => boolean;
  nativeAlert: (
    title: string,
    message: string,
    buttons: ConfirmButton[],
    options: { cancelable: boolean; onDismiss: () => void },
  ) => void;
};

export function createConfirmAction(runtime: ConfirmRuntime) {
  return (
    title: string,
    message: string,
    options: ConfirmActionOptions = {},
  ): Promise<boolean> => {
    const {
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      destructive = false,
    } = options;

    if (runtime.platform === 'web') {
      return Promise.resolve(runtime.webConfirm(`${title}\n\n${message}`));
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (confirmed: boolean) => {
        if (!settled) {
          settled = true;
          resolve(confirmed);
        }
      };

      runtime.nativeAlert(
        title,
        message,
        [
          { text: cancelLabel, style: 'cancel', onPress: () => settle(false) },
          {
            text: confirmLabel,
            style: destructive ? 'destructive' : 'default',
            onPress: () => settle(true),
          },
        ],
        { cancelable: true, onDismiss: () => settle(false) },
      );
    });
  };
}
