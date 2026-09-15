import { action, SingletonAction } from "@elgato/streamdeck";

@action({ UUID: "com.scrthq.runlog.next" })
export class Next extends SingletonAction {}
