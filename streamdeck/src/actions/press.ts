import { action, SingletonAction } from "@elgato/streamdeck";

@action({ UUID: "com.scrthq.runlog.press" })
export class Press extends SingletonAction {}
