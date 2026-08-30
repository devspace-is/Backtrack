import { internalErrorResult, resolveSafeOpener } from "./opener-resolver.js";
import { MESSAGE_TYPES } from "../shared/messages.js";

export function createOpenerMessageListener(tabsApi) {
  return (message, sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPES.GET_OPENER_CONTEXT) {
      return false;
    }

    resolveSafeOpener(sender?.tab, tabsApi)
      .then(sendResponse)
      .catch(() => sendResponse(internalErrorResult(sender?.tab)));

    return true;
  };
}
