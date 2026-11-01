CREATE INDEX "command_comp_idx" ON "command" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "command_device_idx" ON "command" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "day_comp_idx" ON "day" USING btree ("competition_id","sort");--> statement-breakpoint
CREATE INDEX "device_comp_idx" ON "device" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "device_invite_idx" ON "device" USING btree ("invite_id");--> statement-breakpoint
CREATE INDEX "invite_comp_idx" ON "invite" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "member_patrol_idx" ON "member" USING btree ("patrol_id");--> statement-breakpoint
CREATE INDEX "message_comp_idx" ON "message" USING btree ("competition_id","created_at");--> statement-breakpoint
CREATE INDEX "message_read_device_idx" ON "message_read" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "score_item_idx" ON "score" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "score_device_idx" ON "score" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "score_conflict_comp_idx" ON "score_conflict" USING btree ("competition_id","status","created_at");--> statement-breakpoint
CREATE INDEX "score_item_station_idx" ON "score_item" USING btree ("station_id","sort");--> statement-breakpoint
CREATE INDEX "score_revision_score_idx" ON "score_revision" USING btree ("score_id","version");--> statement-breakpoint
CREATE INDEX "status_event_patrol_idx" ON "status_event" USING btree ("patrol_id","at");--> statement-breakpoint
CREATE INDEX "track_comp_idx" ON "track" USING btree ("competition_id","sort");