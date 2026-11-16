import { Bot } from "lucide-react";
import { PendingSubmitButton } from "@/app/(portal)/pending-submit-button";
import { queueRelationshipCommandJob } from "@/app/(portal)/movement/actions";
import {
  relationshipCommandIntents,
  type RelationshipCommandIntent,
} from "@/lib/relationship-command";

type RelationshipCommandShortcutFormProps = {
  contactId: string;
  defaultIntent?: RelationshipCommandIntent;
  primaryMove?: string | null;
  commandPrompt?: string | null;
  returnTo: string;
  source: string;
  title?: string;
};

export function RelationshipCommandShortcutForm({
  contactId,
  defaultIntent = "draft_outreach",
  primaryMove,
  commandPrompt,
  returnTo,
  source,
  title = "Get relationship help",
}: RelationshipCommandShortcutFormProps) {
  return (
    <form action={queueRelationshipCommandJob} className="relationship-command-shortcut">
      <input name="contact_id" type="hidden" value={contactId} />
      <input name="return_to" type="hidden" value={returnTo} />
      <input name="source" type="hidden" value={source} />
      <input name="primary_move" type="hidden" value={primaryMove ?? ""} />
      <input name="command_prompt" type="hidden" value={commandPrompt ?? ""} />
      <div className="mini-item-head">
        <b>{title}</b>
        <span className="pill gold">Assist</span>
      </div>
      <div className="relationship-command-fields">
        <label className="field compact">
          <span>Command</span>
          <select defaultValue={defaultIntent} name="intent">
            {Object.entries(relationshipCommandIntents).map(([intent, command]) => (
              <option key={intent} value={intent}>
                {command.label}
              </option>
            ))}
          </select>
        </label>
        <PendingSubmitButton className="button small ghost" pendingLabel="Preparing…">
          <Bot aria-hidden="true" size={14} />
          Prepare this
        </PendingSubmitButton>
      </div>
    </form>
  );
}
