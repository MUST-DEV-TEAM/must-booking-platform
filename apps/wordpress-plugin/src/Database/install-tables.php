<?php

namespace MustHotelBooking\Database;

/**
 * Explicitly reconcile derived inventory room types against sellable must_rooms.
 *
 * must_rooms remains the authoritative sellable accommodation table in this
 * plugin version. mhb_room_types and mhb_rooms still depend on those room IDs,
 * but this sync helper should only run from deliberate maintenance or save
 * actions, never as a silent page-load or installer side effect.
 *
 * @return array<string, int>
 */
function seed_inventory_model_from_legacy_rooms(): array
{
    global $wpdb;

    $summary = [
        'legacy_types' => 0,
        'mirrored_types_inserted' => 0,
        'mirrored_types_updated' => 0,
        'inventory_units_created' => 0,
    ];

    $room_types_table = $wpdb->prefix . 'mhb_room_types';
    $inventory_rooms_table = $wpdb->prefix . 'mhb_rooms';
    $legacy_rooms_table = $wpdb->prefix . 'must_rooms';
    $room_types_exists = $wpdb->get_var(
        $wpdb->prepare(
            'SHOW TABLES LIKE %s',
            $room_types_table
        )
    );
    $inventory_rooms_exists = $wpdb->get_var(
        $wpdb->prepare(
            'SHOW TABLES LIKE %s',
            $inventory_rooms_table
        )
    );

    if (
        !\is_string($room_types_exists) ||
        $room_types_exists === '' ||
        !\is_string($inventory_rooms_exists) ||
        $inventory_rooms_exists === ''
    ) {
        return $summary;
    }

    $legacy_rooms = $wpdb->get_results(
        'SELECT id, name, description, max_guests, base_price
        FROM ' . $legacy_rooms_table . '
        ORDER BY id ASC',
        ARRAY_A
    );

    if (!\is_array($legacy_rooms)) {
        return $summary;
    }

    foreach ($legacy_rooms as $legacy_room) {
        if (!\is_array($legacy_room)) {
            continue;
        }

        $room_type_id = isset($legacy_room['id']) ? (int) $legacy_room['id'] : 0;

        if ($room_type_id <= 0) {
            continue;
        }

        $summary['legacy_types']++;

        $room_type_data = [
            'name' => isset($legacy_room['name']) ? \sanitize_text_field((string) $legacy_room['name']) : '',
            'description' => isset($legacy_room['description']) ? \sanitize_textarea_field((string) $legacy_room['description']) : '',
            'capacity' => isset($legacy_room['max_guests']) ? \max(1, (int) $legacy_room['max_guests']) : 1,
            'base_price' => isset($legacy_room['base_price']) ? \round((float) $legacy_room['base_price'], 2) : 0.0,
        ];
        $room_type_exists = (int) $wpdb->get_var(
            $wpdb->prepare(
                'SELECT id
                FROM ' . $room_types_table . '
                WHERE id = %d
                LIMIT 1',
                $room_type_id
            )
        );

        if ($room_type_exists > 0) {
            $updated = $wpdb->update(
                $room_types_table,
                $room_type_data,
                ['id' => $room_type_id],
                ['%s', '%s', '%d', '%f'],
                ['%d']
            );

            if ($updated !== false) {
                $summary['mirrored_types_updated']++;
            }
        } else {
            $inserted = $wpdb->insert(
                $room_types_table,
                ['id' => $room_type_id] + $room_type_data,
                ['%d', '%s', '%s', '%d', '%f']
            );

            if ($inserted !== false) {
                $summary['mirrored_types_inserted']++;
            }
        }

        $inventory_room_count = (int) $wpdb->get_var(
            $wpdb->prepare(
                'SELECT COUNT(*)
                FROM ' . $inventory_rooms_table . '
                WHERE room_type_id = %d',
                $room_type_id
            )
        );

        if ($inventory_room_count > 0) {
            continue;
        }

        $insertedUnit = $wpdb->insert(
            $inventory_rooms_table,
            [
                'room_type_id' => $room_type_id,
                'title' => $room_type_data['name'],
                'room_number' => 'RT-' . $room_type_id . '-1',
                'floor' => 0,
                'status' => 'available',
            ],
            ['%d', '%s', '%s', '%d', '%s']
        );

        if ($insertedUnit !== false) {
            $summary['inventory_units_created']++;
        }
    }

    return $summary;
}

/**
 * Create or update plugin database tables.
 */
function install_tables(): void
{
    global $wpdb;

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $charset_collate = $wpdb->get_charset_collate();
    $prefix = $wpdb->prefix;

    $tables = [];

    $tables[] = "CREATE TABLE {$prefix}must_room_categories (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL,
        slug VARCHAR(191) NOT NULL,
        description LONGTEXT NULL,
        sort_order INT(11) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY slug (slug),
        KEY sort_order (sort_order)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_rooms (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL,
        slug VARCHAR(191) NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'standard-rooms',
        description LONGTEXT NULL,
        internal_code VARCHAR(100) NOT NULL DEFAULT '',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        is_bookable TINYINT(1) NOT NULL DEFAULT 1,
        is_online_bookable TINYINT(1) NOT NULL DEFAULT 1,
        is_calendar_visible TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT(11) NOT NULL DEFAULT 0,
        max_adults SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
        max_children SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
        max_guests SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
        default_occupancy SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
        base_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        extra_guest_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        room_size VARCHAR(100) NOT NULL DEFAULT '',
        beds VARCHAR(100) NOT NULL DEFAULT '',
        admin_notes LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY slug (slug),
        KEY category (category),
        KEY max_guests (max_guests),
        KEY is_active (is_active),
        KEY is_bookable (is_bookable),
        KEY sort_order (sort_order)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_room_meta (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        room_id BIGINT(20) UNSIGNED NOT NULL,
        meta_key VARCHAR(191) NOT NULL,
        meta_value LONGTEXT NULL,
        PRIMARY KEY  (id),
        KEY room_id (room_id),
        KEY meta_key (meta_key)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_room_types (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL DEFAULT '',
        description LONGTEXT NULL,
        capacity SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
        base_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        PRIMARY KEY  (id),
        KEY capacity (capacity)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_rooms (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        room_type_id BIGINT(20) UNSIGNED NOT NULL,
        title VARCHAR(191) NOT NULL DEFAULT '',
        room_number VARCHAR(100) NOT NULL DEFAULT '',
        floor INT(11) NOT NULL DEFAULT 0,
        status VARCHAR(30) NOT NULL DEFAULT 'available',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        is_bookable TINYINT(1) NOT NULL DEFAULT 1,
        is_calendar_visible TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT(11) NOT NULL DEFAULT 0,
        capacity_override SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
        building VARCHAR(100) NOT NULL DEFAULT '',
        section VARCHAR(100) NOT NULL DEFAULT '',
        public_title VARCHAR(191) NOT NULL DEFAULT '',
        public_description LONGTEXT NULL,
        public_room_rules LONGTEXT NULL,
        public_amenities_intro LONGTEXT NULL,
        featured_image_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        gallery_image_ids LONGTEXT NULL,
        amenities LONGTEXT NULL,
        room_size VARCHAR(100) NOT NULL DEFAULT '',
        bed_setup VARCHAR(191) NOT NULL DEFAULT '',
        max_guests_override SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
        view_type VARCHAR(100) NOT NULL DEFAULT '',
        public_visible TINYINT(1) NOT NULL DEFAULT 1,
        display_order INT(11) NOT NULL DEFAULT 0,
        admin_notes LONGTEXT NULL,
        PRIMARY KEY  (id),
        KEY room_type_id (room_type_id),
        KEY status (status),
        KEY is_active (is_active),
        KEY is_bookable (is_bookable),
        KEY public_visible (public_visible),
        KEY sort_order (sort_order),
        KEY display_order (display_order),
        UNIQUE KEY room_number (room_number)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_room_housekeeping_statuses (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        inventory_room_id BIGINT(20) UNSIGNED NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'dirty',
        assigned_to_user_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        assigned_by_user_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        assigned_at DATETIME NULL DEFAULT NULL,
        updated_by BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY inventory_room_id (inventory_room_id),
        KEY status (status),
        KEY assigned_to_user_id (assigned_to_user_id),
        KEY assigned_at (assigned_at),
        KEY updated_by (updated_by),
        KEY updated_at (updated_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_room_housekeeping_issues (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        inventory_room_id BIGINT(20) UNSIGNED NOT NULL,
        issue_title VARCHAR(191) NOT NULL DEFAULT '',
        issue_details LONGTEXT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'open',
        created_by BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        updated_by BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY inventory_room_id (inventory_room_id),
        KEY status (status),
        KEY created_by (created_by),
        KEY updated_by (updated_by),
        KEY updated_at (updated_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_housekeeping_handoffs (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        shift_label VARCHAR(191) NOT NULL DEFAULT '',
        notes LONGTEXT NULL,
        dirty_count INT(11) NOT NULL DEFAULT 0,
        clean_count INT(11) NOT NULL DEFAULT 0,
        inspected_count INT(11) NOT NULL DEFAULT 0,
        out_of_order_count INT(11) NOT NULL DEFAULT 0,
        assigned_count INT(11) NOT NULL DEFAULT 0,
        open_issue_count INT(11) NOT NULL DEFAULT 0,
        created_by BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY created_by (created_by),
        KEY created_at (created_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_guests (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        first_name VARCHAR(100) NOT NULL DEFAULT '',
        last_name VARCHAR(100) NOT NULL DEFAULT '',
        email VARCHAR(190) NOT NULL DEFAULT '',
        phone VARCHAR(50) NOT NULL DEFAULT '',
        country VARCHAR(100) NOT NULL DEFAULT '',
        admin_notes LONGTEXT NULL,
        vip_flag TINYINT(1) NOT NULL DEFAULT 0,
        problem_flag TINYINT(1) NOT NULL DEFAULT 0,
        PRIMARY KEY  (id),
        KEY email (email),
        KEY vip_flag (vip_flag),
        KEY problem_flag (problem_flag)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_reservations (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        booking_id VARCHAR(50) NULL DEFAULT NULL,
        room_id BIGINT(20) UNSIGNED NOT NULL,
        room_type_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        assigned_room_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        rate_plan_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        guest_id BIGINT(20) UNSIGNED NOT NULL,
        checkin DATE NOT NULL,
        checkout DATE NOT NULL,
        guests SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        booking_source VARCHAR(50) NOT NULL DEFAULT 'website',
        notes LONGTEXT NULL,
        total_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        coupon_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        coupon_code VARCHAR(100) NOT NULL DEFAULT '',
        coupon_discount_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
        confirmation_flow VARCHAR(50) NOT NULL DEFAULT 'legacy',
        confirmation_claim_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        confirmation_source VARCHAR(80) NOT NULL DEFAULT '',
        confirmed_at DATETIME NULL DEFAULT NULL,
        checked_in_at DATETIME NULL,
        checked_out_at DATETIME NULL,
        cancellation_requested TINYINT(1) NOT NULL DEFAULT 0,
        cancellation_requested_at DATETIME NULL,
        cancellation_requested_by BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        provider VARCHAR(50) NOT NULL DEFAULT 'local',
        provider_booking_id VARCHAR(191) NOT NULL DEFAULT '',
        provider_reservation_id VARCHAR(191) NOT NULL DEFAULT '',
        provider_status VARCHAR(100) NOT NULL DEFAULT '',
        provider_payment_status VARCHAR(100) NOT NULL DEFAULT '',
        provider_sync_status VARCHAR(50) NOT NULL DEFAULT '',
        provider_fulfilment_key VARCHAR(191) NOT NULL DEFAULT '',
        provider_fulfilment_owner VARCHAR(64) NOT NULL DEFAULT '',
        provider_fulfilment_claimed_at DATETIME NULL DEFAULT NULL,
        provider_fulfilment_lease_expires_at DATETIME NULL DEFAULT NULL,
        provider_synced_at DATETIME NULL DEFAULT NULL,
        provider_sync_error TEXT NULL,
        provider_payload_ref VARCHAR(191) NOT NULL DEFAULT '',
        provider_metadata LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY room_id (room_id),
        KEY room_type_id (room_type_id),
        KEY assigned_room_id (assigned_room_id),
        KEY rate_plan_id (rate_plan_id),
        KEY room_stay (room_id, checkin, checkout),
        UNIQUE KEY booking_id (booking_id),
        KEY guest_id (guest_id),
        KEY stay_dates (checkin, checkout),
        KEY status (status),
        KEY booking_source (booking_source),
        KEY payment_status (payment_status),
        KEY confirmation_flow (confirmation_flow),
        KEY confirmation_claim_id (confirmation_claim_id),
        KEY coupon_id (coupon_id),
        KEY coupon_code (coupon_code),
        KEY cancellation_requested (cancellation_requested),
        KEY provider (provider),
        KEY provider_booking_id (provider_booking_id),
        KEY provider_reservation_id (provider_reservation_id),
        KEY provider_sync_status (provider_sync_status),
        KEY provider_fulfilment_lease (provider_fulfilment_lease_expires_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_pricing (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        room_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        name VARCHAR(191) NOT NULL DEFAULT '',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        price_override DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        weekend_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        minimum_nights SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
        priority INT(11) NOT NULL DEFAULT 10,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY room_id (room_id),
        KEY date_range (start_date, end_date),
        KEY minimum_nights (minimum_nights),
        KEY is_active (is_active),
        KEY room_status_dates (room_id, is_active, start_date, end_date, priority)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_availability (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        room_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        name VARCHAR(191) NOT NULL DEFAULT '',
        availability_date DATE NULL DEFAULT NULL,
        end_date DATE NULL DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        is_available TINYINT(1) NOT NULL DEFAULT 1,
        reason VARCHAR(191) NOT NULL DEFAULT '',
        rule_type VARCHAR(50) NOT NULL DEFAULT '',
        rule_value VARCHAR(191) NOT NULL DEFAULT '',
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY room_id (room_id),
        KEY is_active (is_active),
        KEY rule_type (rule_type),
        KEY availability_date (availability_date),
        KEY end_date (end_date),
        KEY room_rule (room_id, rule_type),
        KEY room_day (room_id, availability_date),
        KEY room_status_range (room_id, is_active, availability_date, end_date, rule_type)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_inventory_locks (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        room_id BIGINT(20) UNSIGNED NOT NULL,
        checkin DATE NOT NULL,
        checkout DATE NOT NULL,
        session_id VARCHAR(191) NOT NULL,
        expires_at DATETIME NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY room_stay_session (room_id, checkin, checkout, session_id),
        KEY room_stay_expires (room_id, checkin, checkout, expires_at),
        KEY session_id (session_id),
        KEY expires_at (expires_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_payments (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        reservation_id BIGINT(20) UNSIGNED NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        method VARCHAR(50) NOT NULL DEFAULT '',
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        transaction_id VARCHAR(191) NOT NULL DEFAULT '',
        provider_attempt_reference VARCHAR(191) NOT NULL DEFAULT '',
        attempt_status VARCHAR(32) NOT NULL DEFAULT 'legacy',
        attempt_site_environment VARCHAR(20) NOT NULL DEFAULT '',
        attempt_provider_mode VARCHAR(30) NOT NULL DEFAULT '',
        attempt_account_fingerprint CHAR(64) NOT NULL DEFAULT '',
        attempt_checkout_mode VARCHAR(50) NOT NULL DEFAULT '',
        attempt_clock_environment VARCHAR(20) NOT NULL DEFAULT '',
        attempt_clock_target_fingerprint CHAR(64) NOT NULL DEFAULT '',
        attempt_reservation_set_hash CHAR(64) NOT NULL DEFAULT '',
        attempt_allocation_set_hash CHAR(64) NOT NULL DEFAULT '',
        attempt_group_amount_minor BIGINT(20) NOT NULL DEFAULT -1,
        attempt_currency VARCHAR(10) NOT NULL DEFAULT '',
        attempt_expires_at DATETIME NULL DEFAULT NULL,
        attempt_booking_snapshot_hash CHAR(64) NOT NULL DEFAULT '',
        attempt_failure_code VARCHAR(80) NOT NULL DEFAULT '',
        provider_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        provider_fee_currency VARCHAR(10) NOT NULL DEFAULT '',
        provider_net_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        provider_fee_status VARCHAR(50) NOT NULL DEFAULT 'unknown',
        provider_fee_source VARCHAR(80) NOT NULL DEFAULT '',
        provider_balance_transaction_id VARCHAR(191) NOT NULL DEFAULT '',
        provider_fee_absorbed_by_customer TINYINT(1) NOT NULL DEFAULT 0,
        provider_fee_metadata LONGTEXT NULL,
        paid_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY reservation_id (reservation_id),
        KEY status (status),
        KEY transaction_id (transaction_id),
        KEY provider_attempt_reference (provider_attempt_reference),
        KEY attempt_status (attempt_status),
        KEY attempt_expires_at (attempt_expires_at),
        KEY provider_fee_status (provider_fee_status),
        KEY provider_balance_transaction_id (provider_balance_transaction_id)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_payment_verification_groups (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        provider VARCHAR(50) NOT NULL,
        provider_mode VARCHAR(30) NOT NULL,
        provider_account_fingerprint VARCHAR(64) NOT NULL,
        provider_transaction_reference VARCHAR(191) NOT NULL,
        provider_attempt_reference VARCHAR(191) NOT NULL,
        total_amount_minor BIGINT(20) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        ownership_key VARCHAR(64) NOT NULL,
        allocation_set_hash VARCHAR(64) NOT NULL,
        allocation_count SMALLINT(5) UNSIGNED NOT NULL,
        verification_source VARCHAR(80) NOT NULL,
        provider_event_reference VARCHAR(191) NOT NULL DEFAULT '',
        raw_response_hash VARCHAR(64) NOT NULL DEFAULT '',
        provider_completed_at DATETIME NULL DEFAULT NULL,
        verified_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY ownership_key (ownership_key),
        KEY provider_reference (provider, provider_transaction_reference),
        KEY provider_attempt_reference (provider_attempt_reference)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_payment_verifications (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        verification_group_id BIGINT(20) UNSIGNED NOT NULL,
        payment_id BIGINT(20) UNSIGNED NOT NULL,
        reservation_id BIGINT(20) UNSIGNED NOT NULL,
        amount_minor BIGINT(20) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        claim_hash VARCHAR(64) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY claim_hash (claim_hash),
        UNIQUE KEY payment_id (payment_id),
        UNIQUE KEY group_reservation (verification_group_id, reservation_id),
        KEY reservation_id (reservation_id)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_paid_provider_observations (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        provider VARCHAR(50) NOT NULL,
        provider_mode VARCHAR(30) NOT NULL DEFAULT '',
        provider_account_fingerprint CHAR(64) NOT NULL DEFAULT '',
        provider_transaction_reference VARCHAR(191) NOT NULL DEFAULT '',
        provider_attempt_reference VARCHAR(191) NOT NULL DEFAULT '',
        provider_event_reference VARCHAR(191) NOT NULL DEFAULT '',
        verification_source VARCHAR(80) NOT NULL DEFAULT '',
        observed_status VARCHAR(32) NOT NULL DEFAULT 'paid',
        amount_minor BIGINT(20) NOT NULL DEFAULT -1,
        currency VARCHAR(10) NOT NULL DEFAULT '',
        ownership_key CHAR(64) NOT NULL,
        expected_allocation_set_hash CHAR(64) NOT NULL DEFAULT '',
        rejected_context_hash CHAR(64) NOT NULL DEFAULT '',
        failure_code VARCHAR(80) NOT NULL DEFAULT '',
        recovery_status VARCHAR(32) NOT NULL DEFAULT 'manual_review',
        observed_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL,
        observation_count BIGINT(20) UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY ownership_key (ownership_key),
        KEY provider_reference (provider, provider_transaction_reference),
        KEY provider_attempt_reference (provider_attempt_reference),
        KEY recovery_status (recovery_status)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_paid_provider_observation_allocations (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        observation_id BIGINT(20) UNSIGNED NOT NULL,
        reservation_id BIGINT(20) UNSIGNED NOT NULL,
        allocation_role VARCHAR(20) NOT NULL DEFAULT 'expected',
        amount_minor BIGINT(20) NOT NULL DEFAULT -1,
        currency VARCHAR(10) NOT NULL DEFAULT '',
        allocation_hash CHAR(64) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY allocation_hash (allocation_hash),
        KEY observation_id (observation_id),
        KEY reservation_id (reservation_id)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_refunds (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        reservation_id BIGINT(20) UNSIGNED NOT NULL,
        booking_id VARCHAR(50) NOT NULL DEFAULT '',
        payment_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        provider VARCHAR(50) NOT NULL DEFAULT '',
        clock_booking_id VARCHAR(191) NOT NULL DEFAULT '',
        clock_reservation_id VARCHAR(191) NOT NULL DEFAULT '',
        clock_folio_id VARCHAR(191) NOT NULL DEFAULT '',
        clock_refund_item_id VARCHAR(191) NOT NULL DEFAULT '',
        gateway VARCHAR(50) NOT NULL DEFAULT '',
        provider_payment_reference VARCHAR(191) NOT NULL DEFAULT '',
        provider_refund_id VARCHAR(191) NOT NULL DEFAULT '',
        provider_refund_reference VARCHAR(191) NOT NULL DEFAULT '',
        raw_provider_status VARCHAR(80) NOT NULL DEFAULT '',
        stripe_payment_intent_id VARCHAR(191) NOT NULL DEFAULT '',
        stripe_charge_id VARCHAR(191) NOT NULL DEFAULT '',
        stripe_refund_id VARCHAR(191) NOT NULL DEFAULT '',
        amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        original_paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        provider_fee_retained DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        cancellation_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        final_refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        refund_policy_reason VARCHAR(191) NOT NULL DEFAULT '',
        calculated_by VARCHAR(50) NOT NULL DEFAULT '',
        reason VARCHAR(191) NOT NULL DEFAULT '',
        refund_type VARCHAR(80) NOT NULL DEFAULT 'refund_only',
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        clock_sync_status VARCHAR(50) NOT NULL DEFAULT 'pending',
        requested_by_user_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        idempotency_key VARCHAR(191) NOT NULL DEFAULT '',
        clock_idempotency_key VARCHAR(191) NOT NULL DEFAULT '',
        failed_reason TEXT NULL,
        manual_note TEXT NULL,
        metadata LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL DEFAULT NULL,
        manual_completed_at DATETIME NULL DEFAULT NULL,
        PRIMARY KEY  (id),
        KEY reservation_id (reservation_id),
        KEY payment_id (payment_id),
        KEY provider (provider),
        KEY gateway (gateway),
        KEY provider_payment_reference (provider_payment_reference),
        KEY provider_refund_id (provider_refund_id),
        KEY provider_refund_reference (provider_refund_reference),
        KEY clock_booking_id (clock_booking_id),
        KEY clock_reservation_id (clock_reservation_id),
        KEY clock_folio_id (clock_folio_id),
        KEY stripe_payment_intent_id (stripe_payment_intent_id),
        KEY stripe_charge_id (stripe_charge_id),
        KEY stripe_refund_id (stripe_refund_id),
        KEY status (status),
        KEY clock_sync_status (clock_sync_status),
        KEY idempotency_key (idempotency_key),
        KEY clock_idempotency_key (clock_idempotency_key),
        KEY updated_at (updated_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_clock_folio_accounting (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        payment_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        refund_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        reservation_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        booking_id VARCHAR(50) NOT NULL DEFAULT '',
        gateway VARCHAR(50) NOT NULL DEFAULT '',
        provider_transaction_id VARCHAR(191) NOT NULL DEFAULT '',
        provider_refund_id VARCHAR(191) NOT NULL DEFAULT '',
        clock_booking_id VARCHAR(191) NOT NULL DEFAULT '',
        clock_reservation_id VARCHAR(191) NOT NULL DEFAULT '',
        clock_folio_id VARCHAR(191) NOT NULL DEFAULT '',
        clock_credit_item_id VARCHAR(191) NOT NULL DEFAULT '',
        direction VARCHAR(30) NOT NULL DEFAULT '',
        amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        amount_minor BIGINT(20) NOT NULL DEFAULT 0,
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        verification_status VARCHAR(50) NOT NULL DEFAULT '',
        balance_before DECIMAL(12,2) NULL DEFAULT NULL,
        expected_balance DECIMAL(12,2) NULL DEFAULT NULL,
        actual_balance DECIMAL(12,2) NULL DEFAULT NULL,
        reconciliation_status VARCHAR(50) NOT NULL DEFAULT '',
        idempotency_key VARCHAR(191) NOT NULL DEFAULT '',
        attempts SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
        last_error_code VARCHAR(100) NOT NULL DEFAULT '',
        last_error TEXT NULL,
        next_retry_at DATETIME NULL DEFAULT NULL,
        posted_at DATETIME NULL DEFAULT NULL,
        verified_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY idempotency_key (idempotency_key),
        KEY payment_id (payment_id),
        KEY refund_id (refund_id),
        KEY reservation_id (reservation_id),
        KEY gateway (gateway),
        KEY provider_transaction_id (provider_transaction_id),
        KEY provider_refund_id (provider_refund_id),
        KEY clock_booking_id (clock_booking_id),
        KEY clock_folio_id (clock_folio_id),
        KEY clock_credit_item_id (clock_credit_item_id),
        KEY direction_status (direction, status),
        KEY status (status),
        KEY next_retry_at (next_retry_at),
        KEY updated_at (updated_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_taxes (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL DEFAULT '',
        rule_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
        rule_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        apply_mode VARCHAR(20) NOT NULL DEFAULT 'stay',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY rule_type (rule_type),
        KEY apply_mode (apply_mode)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_coupons (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        code VARCHAR(100) NOT NULL DEFAULT '',
        name VARCHAR(191) NOT NULL DEFAULT '',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
        discount_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        minimum_booking_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        valid_from DATE NOT NULL,
        valid_until DATE NOT NULL,
        usage_limit INT(10) UNSIGNED NOT NULL DEFAULT 0,
        usage_count INT(10) UNSIGNED NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY code (code),
        KEY valid_range (valid_from, valid_until),
        KEY usage_limit (usage_limit),
        KEY is_active (is_active)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}must_activity_log (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        event_type VARCHAR(60) NOT NULL DEFAULT '',
        severity VARCHAR(20) NOT NULL DEFAULT 'info',
        entity_type VARCHAR(60) NOT NULL DEFAULT '',
        entity_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        reference VARCHAR(191) NOT NULL DEFAULT '',
        message VARCHAR(255) NOT NULL DEFAULT '',
        context_json LONGTEXT NULL,
        actor_user_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        actor_role VARCHAR(60) NOT NULL DEFAULT '',
        actor_ip VARCHAR(45) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY event_type (event_type),
        KEY severity (severity),
        KEY entity_lookup (entity_type, entity_id),
        KEY actor_user_id (actor_user_id),
        KEY created_at (created_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_provider_mappings (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        provider VARCHAR(50) NOT NULL DEFAULT '',
        entity_type VARCHAR(80) NOT NULL DEFAULT '',
        local_table VARCHAR(100) NOT NULL DEFAULT '',
        local_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        external_id VARCHAR(191) NOT NULL DEFAULT '',
        external_code VARCHAR(191) NOT NULL DEFAULT '',
        external_parent_id VARCHAR(191) NOT NULL DEFAULT '',
        display_name VARCHAR(191) NOT NULL DEFAULT '',
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        metadata LONGTEXT NULL,
        last_synced_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY provider (provider),
        KEY entity_type (entity_type),
        KEY local_lookup (entity_type, local_id),
        KEY external_id (external_id),
        KEY status (status),
        KEY last_synced_at (last_synced_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_provider_request_logs (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        provider VARCHAR(50) NOT NULL DEFAULT '',
        operation VARCHAR(100) NOT NULL DEFAULT '',
        direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
        correlation_id VARCHAR(191) NOT NULL DEFAULT '',
        idempotency_key VARCHAR(191) NOT NULL DEFAULT '',
        reservation_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        external_id VARCHAR(191) NOT NULL DEFAULT '',
        http_status SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
        success TINYINT(1) NOT NULL DEFAULT 0,
        error_code VARCHAR(100) NOT NULL DEFAULT '',
        error_message TEXT NULL,
        duration_ms INT(10) UNSIGNED NOT NULL DEFAULT 0,
        request_summary LONGTEXT NULL,
        response_summary LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY provider_operation (provider, operation),
        KEY direction (direction),
        KEY correlation_id (correlation_id),
        KEY idempotency_key (idempotency_key),
        KEY reservation_id (reservation_id),
        KEY external_id (external_id),
        KEY success (success),
        KEY created_at (created_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_provider_sync_jobs (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        provider VARCHAR(50) NOT NULL DEFAULT '',
        operation VARCHAR(100) NOT NULL DEFAULT '',
        target_type VARCHAR(80) NOT NULL DEFAULT '',
        target_local_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        target_external_id VARCHAR(191) NOT NULL DEFAULT '',
        status VARCHAR(40) NOT NULL DEFAULT 'pending',
        attempts SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
        max_attempts SMALLINT(5) UNSIGNED NOT NULL DEFAULT 5,
        priority SMALLINT(5) UNSIGNED NOT NULL DEFAULT 10,
        run_after DATETIME NULL DEFAULT NULL,
        locked_at DATETIME NULL DEFAULT NULL,
        last_error TEXT NULL,
        payload LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY provider_status (provider, status),
        KEY operation (operation),
        KEY target_lookup (target_type, target_local_id),
        KEY target_external_id (target_external_id),
        KEY run_after (run_after),
        KEY priority (priority),
        KEY updated_at (updated_at)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_cancellation_policies (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL DEFAULT '',
        hours_before_checkin INT(11) NOT NULL DEFAULT 0,
        penalty_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        description LONGTEXT NULL,
        PRIMARY KEY  (id),
        KEY hours_before_checkin (hours_before_checkin)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_rate_plans (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL DEFAULT '',
        description LONGTEXT NULL,
        cancellation_policy_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        KEY is_active (is_active)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_room_type_rate_plans (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        room_type_id BIGINT(20) UNSIGNED NOT NULL,
        rate_plan_id BIGINT(20) UNSIGNED NOT NULL,
        base_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        max_occupancy SMALLINT(5) UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY room_type_rate_plan (room_type_id, rate_plan_id),
        KEY room_type_id (room_type_id),
        KEY rate_plan_id (rate_plan_id)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_rate_plan_prices (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        rate_plan_id BIGINT(20) UNSIGNED NOT NULL,
        `date` DATE NOT NULL,
        price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        PRIMARY KEY  (id),
        UNIQUE KEY rate_plan_day (rate_plan_id, `date`),
        KEY date_key (`date`)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_seasons (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(191) NOT NULL DEFAULT '',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        priority INT(11) NOT NULL DEFAULT 0,
        PRIMARY KEY  (id),
        KEY date_window (start_date, end_date),
        KEY priority (priority)
    ) {$charset_collate};";

    $tables[] = "CREATE TABLE {$prefix}mhb_seasonal_prices (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        season_id BIGINT(20) UNSIGNED NOT NULL,
        rate_plan_id BIGINT(20) UNSIGNED NOT NULL,
        modifier_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
        modifier_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        PRIMARY KEY  (id),
        UNIQUE KEY season_rate_plan (season_id, rate_plan_id),
        KEY season_id (season_id),
        KEY rate_plan_id (rate_plan_id)
    ) {$charset_collate};";

    foreach ($tables as $sql) {
        \dbDelta($sql);
    }

    ensure_public_access_schema($wpdb);
    ensure_payment_release_schema($wpdb);
    ensure_clock_fulfilment_schema($wpdb);
    ensure_confirmation_integrity_schema($wpdb);
    ensure_payment_attempt_integrity_schema($wpdb);

    \update_option('must_hotel_booking_db_version', MUST_HOTEL_BOOKING_VERSION);
}

/**
 * Ensure the public booking access grant table is present without coupling
 * its repair decision to the plugin release version.
 */
function ensure_public_access_schema(?\wpdb $wpdb_instance = null): void
{
    global $wpdb;

    $db = $wpdb_instance ?: $wpdb;
    $targetVersion = defined('MUST_HOTEL_BOOKING_PUBLIC_ACCESS_SCHEMA_VERSION')
        ? (int) MUST_HOTEL_BOOKING_PUBLIC_ACCESS_SCHEMA_VERSION
        : 2;
    $storedVersion = (int) get_option('must_hotel_booking_public_access_schema_version', 0);
    $table = $db->prefix . 'must_public_booking_access';
    $contextTable = $db->prefix . 'must_public_booking_access_contexts';
    $existingTable = (string) $db->get_var(
        $db->prepare('SHOW TABLES LIKE %s', $table)
    );
    $existingContextTable = (string) $db->get_var(
        $db->prepare('SHOW TABLES LIKE %s', $contextTable)
    );

    if (
        $storedVersion >= $targetVersion
        && $existingTable === $table
        && $existingContextTable === $contextTable
        && public_access_schema_has_required_shape($db, $table, $contextTable)
    ) {
        return;
    }

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $charsetCollate = $db->get_charset_collate();
    $sql = "CREATE TABLE {$table} (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        token_hash CHAR(64) NOT NULL,
        operation_key CHAR(64) NULL DEFAULT NULL,
        purpose VARCHAR(40) NOT NULL DEFAULT '',
        reservation_ids LONGTEXT NOT NULL,
        reservation_set_hash CHAR(64) NOT NULL,
        created_at DATETIME NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME NULL DEFAULT NULL,
        first_used_at DATETIME NULL DEFAULT NULL,
        last_used_at DATETIME NULL DEFAULT NULL,
        execution_status VARCHAR(32) NOT NULL DEFAULT 'available',
        consumed_at DATETIME NULL DEFAULT NULL,
        claimed_at DATETIME NULL DEFAULT NULL,
        completed_at DATETIME NULL DEFAULT NULL,
        failed_at DATETIME NULL DEFAULT NULL,
        metadata_json LONGTEXT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY token_hash (token_hash),
        UNIQUE KEY operation_key (operation_key),
        KEY purpose_expiry (purpose, expires_at),
        KEY reservation_set_lookup (reservation_set_hash, purpose),
        KEY execution_status (execution_status)
    ) {$charsetCollate};";

    $contextSql = "CREATE TABLE {$contextTable} (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        context_hash CHAR(64) NOT NULL,
        grant_id BIGINT(20) UNSIGNED NOT NULL,
        purpose VARCHAR(40) NOT NULL DEFAULT '',
        reservation_set_hash CHAR(64) NOT NULL,
        created_at DATETIME NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME NULL DEFAULT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY context_hash (context_hash),
        KEY grant_purpose (grant_id, purpose),
        KEY context_expiry (expires_at)
    ) {$charsetCollate};";

    \dbDelta($sql);
    \dbDelta($contextSql);

    $verifiedTable = (string) $db->get_var(
        $db->prepare('SHOW TABLES LIKE %s', $table)
    );
    $verifiedContextTable = (string) $db->get_var(
        $db->prepare('SHOW TABLES LIKE %s', $contextTable)
    );
    if (
        $verifiedTable === $table
        && $verifiedContextTable === $contextTable
        && public_access_schema_has_required_shape($db, $table, $contextTable)
    ) {
        update_option('must_hotel_booking_public_access_schema_version', $targetVersion, false);
    }
}

function public_access_schema_has_required_shape(\wpdb $db, string $accessTable, string $contextTable): bool
{
    $accessColumns = $db->get_col('SHOW COLUMNS FROM ' . $accessTable, 0);
    $contextColumns = $db->get_col('SHOW COLUMNS FROM ' . $contextTable, 0);
    $accessIndexes = $db->get_col('SHOW INDEX FROM ' . $accessTable, 2);
    $contextIndexes = $db->get_col('SHOW INDEX FROM ' . $contextTable, 2);
    $accessColumns = is_array($accessColumns) ? array_map('strval', $accessColumns) : [];
    $contextColumns = is_array($contextColumns) ? array_map('strval', $contextColumns) : [];
    $accessIndexes = is_array($accessIndexes) ? array_map('strval', $accessIndexes) : [];
    $contextIndexes = is_array($contextIndexes) ? array_map('strval', $contextIndexes) : [];

    foreach (['token_hash', 'operation_key', 'reservation_ids', 'reservation_set_hash', 'execution_status', 'consumed_at'] as $column) {
        if (!in_array($column, $accessColumns, true)) {
            return false;
        }
    }
    foreach (['context_hash', 'grant_id', 'purpose', 'reservation_set_hash', 'expires_at'] as $column) {
        if (!in_array($column, $contextColumns, true)) {
            return false;
        }
    }

    return in_array('token_hash', $accessIndexes, true)
        && in_array('operation_key', $accessIndexes, true)
        && in_array('context_hash', $contextIndexes, true);
}

/**
 * Repair the additive Clock fulfilment lease columns even when an existing
 * installation already stores the current plugin/database version.
 */
function ensure_clock_fulfilment_schema(?\wpdb $wpdb_instance = null): void
{
    global $wpdb;

    $db = $wpdb_instance ?: $wpdb;
    ensure_table_columns(
        $db,
        $db->prefix . 'must_reservations',
        [
            'provider_fulfilment_key' => "VARCHAR(191) NOT NULL DEFAULT ''",
            'provider_fulfilment_owner' => "VARCHAR(64) NOT NULL DEFAULT ''",
            'provider_fulfilment_claimed_at' => 'DATETIME NULL DEFAULT NULL',
            'provider_fulfilment_lease_expires_at' => 'DATETIME NULL DEFAULT NULL',
        ]
    );
    ensure_table_indexes(
        $db,
        $db->prefix . 'must_reservations',
        ['provider_fulfilment_lease' => 'provider_fulfilment_lease_expires_at']
    );
}

/**
 * Repair the additive confirmation-authorization shape independently of the
 * release version so equal-version upgrades cannot retain a partial schema.
 */
function ensure_confirmation_integrity_schema(?\wpdb $wpdb_instance = null): void
{
    global $wpdb;

    $db = $wpdb_instance ?: $wpdb;
    ensure_table_columns(
        $db,
        $db->prefix . 'must_reservations',
        [
            'confirmation_flow' => "VARCHAR(50) NOT NULL DEFAULT 'legacy'",
            'confirmation_claim_id' => 'BIGINT(20) UNSIGNED NOT NULL DEFAULT 0',
            'confirmation_source' => "VARCHAR(80) NOT NULL DEFAULT ''",
            'confirmed_at' => 'DATETIME NULL DEFAULT NULL',
        ]
    );
    ensure_table_indexes(
        $db,
        $db->prefix . 'must_reservations',
        [
            'confirmation_flow' => 'confirmation_flow',
            'confirmation_claim_id' => 'confirmation_claim_id',
        ]
    );

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $collation = $db->get_charset_collate();
    $groups = $db->prefix . 'must_payment_verification_groups';
    $allocations = $db->prefix . 'must_payment_verifications';
    \dbDelta("CREATE TABLE {$groups} (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        provider VARCHAR(50) NOT NULL,
        provider_mode VARCHAR(30) NOT NULL,
        provider_account_fingerprint VARCHAR(64) NOT NULL,
        provider_transaction_reference VARCHAR(191) NOT NULL,
        provider_attempt_reference VARCHAR(191) NOT NULL,
        total_amount_minor BIGINT(20) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        ownership_key VARCHAR(64) NOT NULL,
        allocation_set_hash VARCHAR(64) NOT NULL,
        allocation_count SMALLINT(5) UNSIGNED NOT NULL,
        verification_source VARCHAR(80) NOT NULL,
        provider_event_reference VARCHAR(191) NOT NULL DEFAULT '',
        raw_response_hash VARCHAR(64) NOT NULL DEFAULT '',
        provider_completed_at DATETIME NULL DEFAULT NULL,
        verified_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY ownership_key (ownership_key),
        KEY provider_reference (provider, provider_transaction_reference),
        KEY provider_attempt_reference (provider_attempt_reference)
    ) {$collation};");
    \dbDelta("CREATE TABLE {$allocations} (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        verification_group_id BIGINT(20) UNSIGNED NOT NULL,
        payment_id BIGINT(20) UNSIGNED NOT NULL,
        reservation_id BIGINT(20) UNSIGNED NOT NULL,
        amount_minor BIGINT(20) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        claim_hash VARCHAR(64) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY claim_hash (claim_hash),
        UNIQUE KEY payment_id (payment_id),
        UNIQUE KEY group_reservation (verification_group_id, reservation_id),
        KEY reservation_id (reservation_id)
    ) {$collation};");
}

/**
 * Additively repair immutable attempt identity and provider-paid observation
 * evidence even when the stored plugin version already matches this release.
 */
function ensure_payment_attempt_integrity_schema(?\wpdb $wpdb_instance = null): void
{
    global $wpdb;

    $db = $wpdb_instance ?: $wpdb;
    ensure_table_columns($db, $db->prefix . 'must_payments', [
        'provider_attempt_reference' => "VARCHAR(191) NOT NULL DEFAULT ''",
        'attempt_status' => "VARCHAR(32) NOT NULL DEFAULT 'legacy'",
        'attempt_site_environment' => "VARCHAR(20) NOT NULL DEFAULT ''",
        'attempt_provider_mode' => "VARCHAR(30) NOT NULL DEFAULT ''",
        'attempt_account_fingerprint' => "CHAR(64) NOT NULL DEFAULT ''",
        'attempt_checkout_mode' => "VARCHAR(50) NOT NULL DEFAULT ''",
        'attempt_clock_environment' => "VARCHAR(20) NOT NULL DEFAULT ''",
        'attempt_clock_target_fingerprint' => "CHAR(64) NOT NULL DEFAULT ''",
        'attempt_reservation_set_hash' => "CHAR(64) NOT NULL DEFAULT ''",
        'attempt_allocation_set_hash' => "CHAR(64) NOT NULL DEFAULT ''",
        'attempt_group_amount_minor' => 'BIGINT(20) NOT NULL DEFAULT -1',
        'attempt_currency' => "VARCHAR(10) NOT NULL DEFAULT ''",
        'attempt_expires_at' => 'DATETIME NULL DEFAULT NULL',
        'attempt_booking_snapshot_hash' => "CHAR(64) NOT NULL DEFAULT ''",
        'attempt_failure_code' => "VARCHAR(80) NOT NULL DEFAULT ''",
    ]);
    ensure_table_indexes($db, $db->prefix . 'must_payments', [
        'provider_attempt_reference' => 'provider_attempt_reference',
        'attempt_status' => 'attempt_status',
        'attempt_expires_at' => 'attempt_expires_at',
    ]);

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $collation = $db->get_charset_collate();
    $observations = $db->prefix . 'must_paid_provider_observations';
    $allocations = $db->prefix . 'must_paid_provider_observation_allocations';
    \dbDelta("CREATE TABLE {$observations} (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        provider VARCHAR(50) NOT NULL,
        provider_mode VARCHAR(30) NOT NULL DEFAULT '',
        provider_account_fingerprint CHAR(64) NOT NULL DEFAULT '',
        provider_transaction_reference VARCHAR(191) NOT NULL DEFAULT '',
        provider_attempt_reference VARCHAR(191) NOT NULL DEFAULT '',
        provider_event_reference VARCHAR(191) NOT NULL DEFAULT '',
        verification_source VARCHAR(80) NOT NULL DEFAULT '',
        observed_status VARCHAR(32) NOT NULL DEFAULT 'paid',
        amount_minor BIGINT(20) NOT NULL DEFAULT -1,
        currency VARCHAR(10) NOT NULL DEFAULT '',
        ownership_key CHAR(64) NOT NULL,
        expected_allocation_set_hash CHAR(64) NOT NULL DEFAULT '',
        rejected_context_hash CHAR(64) NOT NULL DEFAULT '',
        failure_code VARCHAR(80) NOT NULL DEFAULT '',
        recovery_status VARCHAR(32) NOT NULL DEFAULT 'manual_review',
        observed_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL,
        observation_count BIGINT(20) UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY ownership_key (ownership_key),
        KEY provider_reference (provider, provider_transaction_reference),
        KEY provider_attempt_reference (provider_attempt_reference),
        KEY recovery_status (recovery_status)
    ) {$collation};");
    \dbDelta("CREATE TABLE {$allocations} (
        id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
        observation_id BIGINT(20) UNSIGNED NOT NULL,
        reservation_id BIGINT(20) UNSIGNED NOT NULL,
        allocation_role VARCHAR(20) NOT NULL DEFAULT 'expected',
        amount_minor BIGINT(20) NOT NULL DEFAULT -1,
        currency VARCHAR(10) NOT NULL DEFAULT '',
        allocation_hash CHAR(64) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY  (id),
        UNIQUE KEY allocation_hash (allocation_hash),
        KEY observation_id (observation_id),
        KEY reservation_id (reservation_id)
    ) {$collation};");
}

/**
 * Ensure release-added payment/refund columns exist on databases that already
 * stored the current DB version before dbDelta saw the new schema.
 */
function ensure_payment_release_schema(?\wpdb $wpdb_instance = null): void
{
    global $wpdb;

    $db = $wpdb_instance ?: $wpdb;

    ensure_table_columns(
        $db,
        $db->prefix . 'must_payments',
        [
            'provider_fee_amount' => "DECIMAL(12,2) NOT NULL DEFAULT 0.00",
            'provider_fee_currency' => "VARCHAR(10) NOT NULL DEFAULT ''",
            'provider_net_amount' => "DECIMAL(12,2) NOT NULL DEFAULT 0.00",
            'provider_fee_status' => "VARCHAR(50) NOT NULL DEFAULT 'unknown'",
            'provider_fee_source' => "VARCHAR(80) NOT NULL DEFAULT ''",
            'provider_balance_transaction_id' => "VARCHAR(191) NOT NULL DEFAULT ''",
            'provider_fee_absorbed_by_customer' => "TINYINT(1) NOT NULL DEFAULT 0",
            'provider_fee_metadata' => "LONGTEXT NULL",
        ]
    );

    ensure_table_indexes(
        $db,
        $db->prefix . 'must_payments',
        [
            'provider_fee_status' => 'provider_fee_status',
            'provider_balance_transaction_id' => 'provider_balance_transaction_id',
        ]
    );

    ensure_table_columns(
        $db,
        $db->prefix . 'must_refunds',
        [
            'original_paid_amount' => "DECIMAL(12,2) NOT NULL DEFAULT 0.00",
            'provider_fee_retained' => "DECIMAL(12,2) NOT NULL DEFAULT 0.00",
            'cancellation_fee_amount' => "DECIMAL(12,2) NOT NULL DEFAULT 0.00",
            'final_refund_amount' => "DECIMAL(12,2) NOT NULL DEFAULT 0.00",
            'refund_policy_reason' => "VARCHAR(191) NOT NULL DEFAULT ''",
            'calculated_by' => "VARCHAR(50) NOT NULL DEFAULT ''",
        ]
    );
    ensure_table_columns(
        $db,
        $db->prefix . 'must_clock_folio_accounting',
        [
            'balance_before' => 'DECIMAL(12,2) NULL DEFAULT NULL',
            'expected_balance' => 'DECIMAL(12,2) NULL DEFAULT NULL',
            'actual_balance' => 'DECIMAL(12,2) NULL DEFAULT NULL',
            'reconciliation_status' => "VARCHAR(50) NOT NULL DEFAULT ''",
        ]
    );
}

/**
 * @param array<string, string> $columns
 */
function ensure_table_columns(\wpdb $wpdb, string $table, array $columns): void
{
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table));

    if ((string) $exists !== $table) {
        return;
    }

    $existingColumns = $wpdb->get_col('SHOW COLUMNS FROM ' . $table, 0);
    $existingColumns = \is_array($existingColumns) ? \array_map('strval', $existingColumns) : [];

    foreach ($columns as $column => $definition) {
        if (\in_array($column, $existingColumns, true)) {
            continue;
        }

        $wpdb->query('ALTER TABLE ' . $table . ' ADD COLUMN ' . $column . ' ' . $definition);
    }
}

/**
 * @param array<string, string> $indexes
 */
function ensure_table_indexes(\wpdb $wpdb, string $table, array $indexes): void
{
    $exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table));

    if ((string) $exists !== $table) {
        return;
    }

    $existingIndexes = $wpdb->get_col('SHOW INDEX FROM ' . $table, 2);
    $existingIndexes = \is_array($existingIndexes) ? \array_map('strval', $existingIndexes) : [];

    foreach ($indexes as $index => $column) {
        if (\in_array($index, $existingIndexes, true)) {
            continue;
        }

        $wpdb->query('ALTER TABLE ' . $table . ' ADD INDEX ' . $index . ' (' . $column . ')');
    }
}
