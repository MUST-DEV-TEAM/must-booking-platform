<?php

namespace MustHotelBooking\Core;

final class StaffAccess
{
    // User meta key used to disable individual staff portal access (plugin-managed, not WP deactivation)
    public const USERMETA_STAFF_DISABLED = 'mhb_staff_disabled';

    // Current roles
    public const ROLE_FRONT_DESK  = 'mhb_front_desk';
    public const ROLE_SUPERVISOR  = 'mhb_supervisor';
    public const ROLE_HOUSEKEEPING = 'mhb_housekeeping';
    public const ROLE_FINANCE     = 'mhb_finance';
    public const ROLE_OPS_MANAGER = 'mhb_ops_manager';

    // Deprecated role aliases — kept so any code referencing them still compiles.
    // These will be migrated to new roles in schema version 2.
    /** @deprecated Use ROLE_FRONT_DESK */
    public const ROLE_WORKER  = 'mhb_front_desk';
    /** @deprecated Use ROLE_SUPERVISOR */
    public const ROLE_MANAGER = 'mhb_supervisor';

    // -------------------------------------------------------------------------
    // Capabilities — Dashboard
    // -------------------------------------------------------------------------
    public const CAP_DASHBOARD_VIEW = 'mhb_dashboard_view';

    // -------------------------------------------------------------------------
    // Capabilities — Reservations
    // -------------------------------------------------------------------------
    public const CAP_RESERVATION_VIEW         = 'mhb_reservation_view';
    public const CAP_RESERVATION_CREATE       = 'mhb_reservation_create';
    public const CAP_RESERVATION_EDIT_BASIC   = 'mhb_reservation_edit_basic';
    public const CAP_RESERVATION_EDIT_STAY    = 'mhb_reservation_edit_stay';
    public const CAP_RESERVATION_ASSIGN_ROOM  = 'mhb_reservation_assign_room';
    public const CAP_RESERVATION_MOVE_ROOM    = 'mhb_reservation_move_room';
    public const CAP_RESERVATION_CHECKIN      = 'mhb_reservation_checkin';
    public const CAP_RESERVATION_CHECKOUT     = 'mhb_reservation_checkout';
    public const CAP_RESERVATION_CANCEL       = 'mhb_reservation_cancel';
    public const CAP_RESERVATION_NO_SHOW      = 'mhb_reservation_mark_no_show';
    public const CAP_RESERVATION_BULK         = 'mhb_reservation_bulk_actions';

    // -------------------------------------------------------------------------
    // Capabilities — Guests
    // -------------------------------------------------------------------------
    public const CAP_GUEST_VIEW         = 'mhb_guest_view';
    public const CAP_GUEST_EDIT_CONTACT = 'mhb_guest_edit_contact';
    public const CAP_GUEST_EDIT_FLAGS   = 'mhb_guest_edit_flags';
    public const CAP_GUEST_ADD_NOTE     = 'mhb_guest_add_note';

    // -------------------------------------------------------------------------
    // Capabilities — Payments
    // -------------------------------------------------------------------------
    public const CAP_PAYMENT_VIEW          = 'mhb_payment_view';
    public const CAP_PAYMENT_POST          = 'mhb_payment_post';
    public const CAP_PAYMENT_POST_PARTIAL  = 'mhb_payment_post_partial';
    public const CAP_PAYMENT_MARK_PAID     = 'mhb_payment_mark_paid';
    public const CAP_PAYMENT_REFUND        = 'mhb_payment_refund';
    public const CAP_PAYMENT_RECEIPT       = 'mhb_payment_receipt_issue';
    public const CAP_PAYMENT_INVOICE       = 'mhb_payment_invoice_issue';
    public const CAP_PAYMENT_RECONCILE     = 'mhb_payment_reconcile';

    // -------------------------------------------------------------------------
    // Capabilities — Calendar
    // -------------------------------------------------------------------------
    public const CAP_CALENDAR_VIEW          = 'mhb_calendar_view';
    public const CAP_CALENDAR_MOVE          = 'mhb_calendar_move_reservation';
    public const CAP_CALENDAR_CREATE_BLOCK  = 'mhb_calendar_create_block';
    public const CAP_CALENDAR_EDIT_BLOCK    = 'mhb_calendar_edit_block';

    // -------------------------------------------------------------------------
    // Capabilities — Housekeeping
    // -------------------------------------------------------------------------
    public const CAP_HOUSEKEEPING_VIEW          = 'mhb_housekeeping_view';
    public const CAP_HOUSEKEEPING_UPDATE_STATUS = 'mhb_housekeeping_update_status';
    public const CAP_HOUSEKEEPING_ASSIGN_STAFF  = 'mhb_housekeeping_assign_staff';
    public const CAP_HOUSEKEEPING_INSPECT       = 'mhb_housekeeping_inspect_room';
    public const CAP_HOUSEKEEPING_CREATE_ISSUE  = 'mhb_housekeeping_create_issue';

    // -------------------------------------------------------------------------
    // Capabilities — Rooms & Availability
    // -------------------------------------------------------------------------
    public const CAP_INVENTORY_VIEW             = 'mhb_inventory_view';
    public const CAP_AVAILABILITY_RULES_VIEW    = 'mhb_availability_rules_view';
    public const CAP_AVAILABILITY_RULES_EDIT    = 'mhb_availability_rules_edit';
    public const CAP_ROOM_BLOCK_MANAGE          = 'mhb_room_block_manage';

    // Room and room-type CRUD stays in WP-Admin only (Option A — portal provides
    // view access; create/edit/delete is reserved for the Administrator role via
    // wp-admin, not via portal actions).

    // -------------------------------------------------------------------------
    // Capabilities — Reports
    // -------------------------------------------------------------------------
    public const CAP_REPORT_VIEW_OPS        = 'mhb_report_view_ops';
    public const CAP_REPORT_VIEW_FINANCE    = 'mhb_report_view_finance';
    public const CAP_REPORT_VIEW_MANAGEMENT = 'mhb_report_view_management';
    public const CAP_REPORT_EXPORT          = 'mhb_report_export';
    public const CAP_AUDIT_VIEW             = 'mhb_audit_view';

    // -------------------------------------------------------------------------
    // Capabilities — Administration
    // -------------------------------------------------------------------------
    public const CAP_STAFF_MANAGE          = 'mhb_staff_manage';
    public const CAP_ROLE_MANAGE           = 'mhb_role_manage';
    public const CAP_PORTAL_SETTINGS       = 'mhb_portal_settings_manage';
    public const CAP_PLUGIN_SETTINGS       = 'mhb_plugin_settings_manage';
    public const CAP_ACCESS_PORTAL         = 'must_hotel_booking_access_portal';

    // -------------------------------------------------------------------------
    // Deprecated capability aliases — preserved so call sites compiled against
    // the old constants still work without a hard break.
    // -------------------------------------------------------------------------
    /** @deprecated Use CAP_DASHBOARD_VIEW */
    public const CAP_VIEW_DASHBOARD = 'mhb_dashboard_view';
    /** @deprecated Use CAP_RESERVATION_VIEW */
    public const CAP_VIEW_RESERVATIONS = 'mhb_reservation_view';
    /** @deprecated Use CAP_RESERVATION_EDIT_BASIC or CAP_RESERVATION_EDIT_STAY */
    public const CAP_EDIT_RESERVATIONS = 'mhb_reservation_edit_basic';
    /** @deprecated Use CAP_CALENDAR_VIEW */
    public const CAP_VIEW_CALENDAR = 'mhb_calendar_view';
    /** @deprecated Use CAP_RESERVATION_CREATE */
    public const CAP_CREATE_QUICK_BOOKING = 'mhb_reservation_create';
    /** @deprecated Use CAP_GUEST_VIEW */
    public const CAP_VIEW_GUESTS = 'mhb_guest_view';
    /** @deprecated Use CAP_PAYMENT_VIEW */
    public const CAP_VIEW_PAYMENTS = 'mhb_payment_view';
    /** @deprecated Use CAP_PAYMENT_MARK_PAID */
    public const CAP_MARK_PAYMENT_AS_PAID = 'mhb_payment_mark_paid';
    /** @deprecated Use CAP_RESERVATION_CANCEL */
    public const CAP_CANCEL_RESERVATION = 'mhb_reservation_cancel';
    /** @deprecated Use CAP_REPORT_VIEW_OPS */
    public const CAP_VIEW_REPORTS = 'mhb_report_view_ops';
    /** @deprecated Use CAP_INVENTORY_VIEW */
    public const CAP_VIEW_ACCOMMODATIONS = 'mhb_inventory_view';
    /** @deprecated Use CAP_AVAILABILITY_RULES_VIEW */
    public const CAP_VIEW_AVAILABILITY_RULES = 'mhb_availability_rules_view';
    /** @deprecated Use CAP_PLUGIN_SETTINGS */
    public const CAP_ACCESS_SETTINGS = 'mhb_plugin_settings_manage';

    private const LEGACY_ROLE_MIGRATION_OPTION = 'must_hotel_booking_staff_role_schema_version';
    private const LEGACY_ROLE_SCHEMA_VERSION = 2;
    private const CAPABILITY_ALIGNMENT_OPTION = 'must_hotel_booking_staff_capability_alignment_version';
    private const CAPABILITY_ALIGNMENT_VERSION = 2;

    /**
     * @return array<string, string>
     */
    public static function getRoleLabels(): array
    {
        return [
            self::ROLE_FRONT_DESK   => \__('Front Desk Agent', 'must-hotel-booking'),
            self::ROLE_SUPERVISOR   => \__('Front Office Supervisor', 'must-hotel-booking'),
            self::ROLE_HOUSEKEEPING => \__('Housekeeping', 'must-hotel-booking'),
            self::ROLE_FINANCE      => \__('Finance / Cashier', 'must-hotel-booking'),
            self::ROLE_OPS_MANAGER  => \__('Operations Manager', 'must-hotel-booking'),
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function getRoleDescriptions(): array
    {
        return [
            self::ROLE_FRONT_DESK   => \__('Handles arrivals, departures, guest service, reservations, and standard payments from the staff portal.', 'must-hotel-booking'),
            self::ROLE_SUPERVISOR   => \__('Oversees desk operations; approves cancellations, refunds, room moves, and exceptions.', 'must-hotel-booking'),
            self::ROLE_HOUSEKEEPING => \__('Manages room readiness, cleaning status, assignments, and maintenance issues.', 'must-hotel-booking'),
            self::ROLE_FINANCE      => \__('Handles payment posting, refunds, receipts, invoices, and reconciliation.', 'must-hotel-booking'),
            self::ROLE_OPS_MANAGER  => \__('Full operational access: approvals, reports, room inventory management, audit log.', 'must-hotel-booking'),
        ];
    }

    /**
     * @return array<string, string>
     */
    public static function getCapabilityLabels(): array
    {
        return [
            'dashboard_view'              => \__('View dashboard', 'must-hotel-booking'),
            'reservation_view'            => \__('View reservations', 'must-hotel-booking'),
            'reservation_create'          => \__('Create reservations', 'must-hotel-booking'),
            'reservation_edit_basic'      => \__('Edit reservation basics (notes, source, email)', 'must-hotel-booking'),
            'reservation_edit_stay'       => \__('Edit stay details (dates, guest count)', 'must-hotel-booking'),
            'reservation_assign_room'     => \__('Assign / reassign room', 'must-hotel-booking'),
            'reservation_move_room'       => \__('Move room (requires approval context)', 'must-hotel-booking'),
            'reservation_checkin'         => \__('Check in guest', 'must-hotel-booking'),
            'reservation_checkout'        => \__('Check out guest', 'must-hotel-booking'),
            'reservation_cancel'          => \__('Cancel reservation', 'must-hotel-booking'),
            'reservation_mark_no_show'    => \__('Mark no-show', 'must-hotel-booking'),
            'reservation_bulk_actions'    => \__('Bulk reservation actions', 'must-hotel-booking'),
            'guest_view'                  => \__('View guests', 'must-hotel-booking'),
            'guest_edit_contact'          => \__('Edit guest contact info', 'must-hotel-booking'),
            'guest_edit_flags'            => \__('Edit guest flags (VIP, blacklist)', 'must-hotel-booking'),
            'guest_add_note'              => \__('Add guest / service note', 'must-hotel-booking'),
            'payment_view'                => \__('View payments', 'must-hotel-booking'),
            'payment_post'                => \__('Post payment', 'must-hotel-booking'),
            'payment_post_partial'        => \__('Post partial payment', 'must-hotel-booking'),
            'payment_mark_paid'           => \__('Mark as paid', 'must-hotel-booking'),
            'payment_refund'              => \__('Issue refund', 'must-hotel-booking'),
            'payment_receipt_issue'       => \__('Issue receipt', 'must-hotel-booking'),
            'payment_invoice_issue'       => \__('Issue invoice', 'must-hotel-booking'),
            'payment_reconcile'           => \__('Reconcile payments', 'must-hotel-booking'),
            'calendar_view'               => \__('View calendar', 'must-hotel-booking'),
            'calendar_move_reservation'   => \__('Move reservation on calendar', 'must-hotel-booking'),
            'calendar_create_block'       => \__('Create availability block', 'must-hotel-booking'),
            'calendar_edit_block'         => \__('Edit / remove availability block', 'must-hotel-booking'),
            'housekeeping_view'           => \__('View housekeeping board', 'must-hotel-booking'),
            'housekeeping_update_status'  => \__('Update room cleaning status', 'must-hotel-booking'),
            'housekeeping_assign_staff'   => \__('Assign housekeeping staff', 'must-hotel-booking'),
            'housekeeping_inspect_room'   => \__('Mark room inspected / hand off', 'must-hotel-booking'),
            'housekeeping_create_issue'   => \__('Create maintenance issue', 'must-hotel-booking'),
            'inventory_view'              => \__('View rooms and availability', 'must-hotel-booking'),
            'availability_rules_view'     => \__('View availability rules', 'must-hotel-booking'),
            'availability_rules_edit'     => \__('Edit availability rules', 'must-hotel-booking'),
            'room_block_manage'           => \__('Manage availability blocks', 'must-hotel-booking'),
            'report_view_ops'             => \__('View operational reports', 'must-hotel-booking'),
            'report_view_finance'         => \__('View finance reports', 'must-hotel-booking'),
            'report_view_management'      => \__('View management reports', 'must-hotel-booking'),
            'report_export'               => \__('Export reports', 'must-hotel-booking'),
            'audit_view'                  => \__('View audit log', 'must-hotel-booking'),
            'plugin_settings_manage'      => \__('Manage plugin settings', 'must-hotel-booking'),
        ];
    }

    /**
     * Maps short capability keys (used in the matrix) to full WP capability strings.
     *
     * @return array<string, string>
     */
    public static function getCapabilityKeyMap(): array
    {
        return [
            'dashboard_view'             => self::CAP_DASHBOARD_VIEW,
            'reservation_view'           => self::CAP_RESERVATION_VIEW,
            'reservation_create'         => self::CAP_RESERVATION_CREATE,
            'reservation_edit_basic'     => self::CAP_RESERVATION_EDIT_BASIC,
            'reservation_edit_stay'      => self::CAP_RESERVATION_EDIT_STAY,
            'reservation_assign_room'    => self::CAP_RESERVATION_ASSIGN_ROOM,
            'reservation_move_room'      => self::CAP_RESERVATION_MOVE_ROOM,
            'reservation_checkin'        => self::CAP_RESERVATION_CHECKIN,
            'reservation_checkout'       => self::CAP_RESERVATION_CHECKOUT,
            'reservation_cancel'         => self::CAP_RESERVATION_CANCEL,
            'reservation_mark_no_show'   => self::CAP_RESERVATION_NO_SHOW,
            'reservation_bulk_actions'   => self::CAP_RESERVATION_BULK,
            'guest_view'                 => self::CAP_GUEST_VIEW,
            'guest_edit_contact'         => self::CAP_GUEST_EDIT_CONTACT,
            'guest_edit_flags'           => self::CAP_GUEST_EDIT_FLAGS,
            'guest_add_note'             => self::CAP_GUEST_ADD_NOTE,
            'payment_view'               => self::CAP_PAYMENT_VIEW,
            'payment_post'               => self::CAP_PAYMENT_POST,
            'payment_post_partial'       => self::CAP_PAYMENT_POST_PARTIAL,
            'payment_mark_paid'          => self::CAP_PAYMENT_MARK_PAID,
            'payment_refund'             => self::CAP_PAYMENT_REFUND,
            'payment_receipt_issue'      => self::CAP_PAYMENT_RECEIPT,
            'payment_invoice_issue'      => self::CAP_PAYMENT_INVOICE,
            'payment_reconcile'          => self::CAP_PAYMENT_RECONCILE,
            'calendar_view'              => self::CAP_CALENDAR_VIEW,
            'calendar_move_reservation'  => self::CAP_CALENDAR_MOVE,
            'calendar_create_block'      => self::CAP_CALENDAR_CREATE_BLOCK,
            'calendar_edit_block'        => self::CAP_CALENDAR_EDIT_BLOCK,
            'housekeeping_view'          => self::CAP_HOUSEKEEPING_VIEW,
            'housekeeping_update_status' => self::CAP_HOUSEKEEPING_UPDATE_STATUS,
            'housekeeping_assign_staff'  => self::CAP_HOUSEKEEPING_ASSIGN_STAFF,
            'housekeeping_inspect_room'  => self::CAP_HOUSEKEEPING_INSPECT,
            'housekeeping_create_issue'  => self::CAP_HOUSEKEEPING_CREATE_ISSUE,
            'inventory_view'             => self::CAP_INVENTORY_VIEW,
            'availability_rules_view'    => self::CAP_AVAILABILITY_RULES_VIEW,
            'availability_rules_edit'    => self::CAP_AVAILABILITY_RULES_EDIT,
            'room_block_manage'          => self::CAP_ROOM_BLOCK_MANAGE,
            'report_view_ops'            => self::CAP_REPORT_VIEW_OPS,
            'report_view_finance'        => self::CAP_REPORT_VIEW_FINANCE,
            'report_view_management'     => self::CAP_REPORT_VIEW_MANAGEMENT,
            'report_export'              => self::CAP_REPORT_EXPORT,
            'audit_view'                 => self::CAP_AUDIT_VIEW,
            'plugin_settings_manage'     => self::CAP_PLUGIN_SETTINGS,
        ];
    }

    /**
     * Maps portal module keys to their primary capability.
     *
     * Modules that intentionally allow more than one capability should be
     * resolved through getPortalModuleCapabilities().
     *
     * @return array<string, string>
     */
    public static function getPortalModuleCapabilityMap(): array
    {
        return [
            'dashboard'         => self::CAP_DASHBOARD_VIEW,
            'reservations'      => self::CAP_RESERVATION_VIEW,
            'calendar'          => self::CAP_CALENDAR_VIEW,
            'front_desk'        => self::CAP_RESERVATION_CREATE,
            'guests'            => self::CAP_GUEST_VIEW,
            'payments'          => self::CAP_PAYMENT_VIEW,
            'housekeeping'      => self::CAP_HOUSEKEEPING_VIEW,
            'rooms_availability'=> self::CAP_INVENTORY_VIEW,
            'reports'           => self::CAP_REPORT_VIEW_OPS,
        ];
    }

    /**
     * @return array<int, string>
     */
    public static function getPortalModuleCapabilities(string $moduleKey): array
    {
        $moduleKey = \sanitize_key($moduleKey);

        if ($moduleKey === 'reports') {
            return [
                self::CAP_REPORT_VIEW_OPS,
                self::CAP_REPORT_VIEW_FINANCE,
                self::CAP_REPORT_VIEW_MANAGEMENT,
            ];
        }

        $capability = (string) (self::getPortalModuleCapabilityMap()[$moduleKey] ?? '');

        return $capability !== '' ? [$capability] : [];
    }

    /**
     * Default capability assignments per role.
     * Keys match getCapabilityKeyMap().
     *
     * @return array<string, array<string, bool>>
     */
    public static function getDefaultCapabilityMatrix(): array
    {
        return [
            self::ROLE_FRONT_DESK => [
                'dashboard_view'             => true,
                'reservation_view'           => true,
                'reservation_create'         => true,
                'reservation_edit_basic'     => true,
                'reservation_edit_stay'      => true,
                'reservation_assign_room'    => true,
                'reservation_move_room'      => false,
                'reservation_checkin'        => true,
                'reservation_checkout'       => true,
                'reservation_cancel'         => false,
                'reservation_mark_no_show'   => true,
                'reservation_bulk_actions'   => false,
                'guest_view'                 => true,
                'guest_edit_contact'         => true,
                'guest_edit_flags'           => false,
                'guest_add_note'             => true,
                'payment_view'               => true,
                'payment_post'               => true,
                'payment_post_partial'       => true,
                'payment_mark_paid'          => true,
                'payment_refund'             => false,
                'payment_receipt_issue'      => true,
                'payment_invoice_issue'      => false,
                'payment_reconcile'          => false,
                'calendar_view'              => true,
                'calendar_move_reservation'  => true,
                'calendar_create_block'      => false,
                'calendar_edit_block'        => false,
                'housekeeping_view'          => true,
                'housekeeping_update_status' => false,
                'housekeeping_assign_staff'  => false,
                'housekeeping_inspect_room'  => false,
                'housekeeping_create_issue'  => false,
                'inventory_view'             => true,
                'availability_rules_view'    => false,
                'availability_rules_edit'    => false,
                'room_block_manage'          => false,
                'report_view_ops'            => false,
                'report_view_finance'        => false,
                'report_view_management'     => false,
                'report_export'              => false,
                'audit_view'                 => false,
                'plugin_settings_manage'     => false,
            ],
            self::ROLE_SUPERVISOR => [
                'dashboard_view'             => true,
                'reservation_view'           => true,
                'reservation_create'         => true,
                'reservation_edit_basic'     => true,
                'reservation_edit_stay'      => true,
                'reservation_assign_room'    => true,
                'reservation_move_room'      => true,
                'reservation_checkin'        => true,
                'reservation_checkout'       => true,
                'reservation_cancel'         => true,
                'reservation_mark_no_show'   => true,
                'reservation_bulk_actions'   => true,
                'guest_view'                 => true,
                'guest_edit_contact'         => true,
                'guest_edit_flags'           => true,
                'guest_add_note'             => true,
                'payment_view'               => true,
                'payment_post'               => true,
                'payment_post_partial'       => true,
                'payment_mark_paid'          => true,
                'payment_refund'             => true,
                'payment_receipt_issue'      => true,
                'payment_invoice_issue'      => true,
                'payment_reconcile'          => false,
                'calendar_view'              => true,
                'calendar_move_reservation'  => true,
                'calendar_create_block'      => true,
                'calendar_edit_block'        => true,
                'housekeeping_view'          => true,
                'housekeeping_update_status' => false,
                'housekeeping_assign_staff'  => true,
                'housekeeping_inspect_room'  => true,
                'housekeeping_create_issue'  => true,
                'inventory_view'             => true,
                'availability_rules_view'    => true,
                'availability_rules_edit'    => false,
                'room_block_manage'          => true,
                'report_view_ops'            => true,
                'report_view_finance'        => false,
                'report_view_management'     => false,
                'report_export'              => true,
                'audit_view'                 => false,
                'plugin_settings_manage'     => false,
            ],
            self::ROLE_HOUSEKEEPING => [
                'dashboard_view'             => true,
                'reservation_view'           => true,
                'reservation_create'         => false,
                'reservation_edit_basic'     => false,
                'reservation_edit_stay'      => false,
                'reservation_assign_room'    => false,
                'reservation_move_room'      => false,
                'reservation_checkin'        => false,
                'reservation_checkout'       => false,
                'reservation_cancel'         => false,
                'reservation_mark_no_show'   => false,
                'reservation_bulk_actions'   => false,
                'guest_view'                 => true,
                'guest_edit_contact'         => false,
                'guest_edit_flags'           => false,
                'guest_add_note'             => true,
                'payment_view'               => false,
                'payment_post'               => false,
                'payment_post_partial'       => false,
                'payment_mark_paid'          => false,
                'payment_refund'             => false,
                'payment_receipt_issue'      => false,
                'payment_invoice_issue'      => false,
                'payment_reconcile'          => false,
                'calendar_view'              => true,
                'calendar_move_reservation'  => false,
                'calendar_create_block'      => false,
                'calendar_edit_block'        => false,
                'housekeeping_view'          => true,
                'housekeeping_update_status' => true,
                'housekeeping_assign_staff'  => true,
                'housekeeping_inspect_room'  => true,
                'housekeeping_create_issue'  => true,
                'inventory_view'             => true,
                'availability_rules_view'    => true,
                'availability_rules_edit'    => false,
                'room_block_manage'          => false,
                'report_view_ops'            => false,
                'report_view_finance'        => false,
                'report_view_management'     => false,
                'report_export'              => false,
                'audit_view'                 => false,
                'plugin_settings_manage'     => false,
            ],
            self::ROLE_FINANCE => [
                'dashboard_view'             => true,
                'reservation_view'           => true,
                'reservation_create'         => false,
                'reservation_edit_basic'     => false,
                'reservation_edit_stay'      => false,
                'reservation_assign_room'    => false,
                'reservation_move_room'      => false,
                'reservation_checkin'        => false,
                'reservation_checkout'       => false,
                'reservation_cancel'         => false,
                'reservation_mark_no_show'   => false,
                'reservation_bulk_actions'   => false,
                'guest_view'                 => true,
                'guest_edit_contact'         => true,
                'guest_edit_flags'           => false,
                'guest_add_note'             => true,
                'payment_view'               => true,
                'payment_post'               => true,
                'payment_post_partial'       => true,
                'payment_mark_paid'          => true,
                'payment_refund'             => true,
                'payment_receipt_issue'      => true,
                'payment_invoice_issue'      => true,
                'payment_reconcile'          => true,
                'calendar_view'              => true,
                'calendar_move_reservation'  => false,
                'calendar_create_block'      => false,
                'calendar_edit_block'        => false,
                'housekeeping_view'          => false,
                'housekeeping_update_status' => false,
                'housekeeping_assign_staff'  => false,
                'housekeeping_inspect_room'  => false,
                'housekeeping_create_issue'  => false,
                'inventory_view'             => false,
                'availability_rules_view'    => false,
                'availability_rules_edit'    => false,
                'room_block_manage'          => false,
                'report_view_ops'            => false,
                'report_view_finance'        => true,
                'report_view_management'     => false,
                'report_export'              => true,
                'audit_view'                 => false,
                'plugin_settings_manage'     => false,
            ],
            self::ROLE_OPS_MANAGER => [
                'dashboard_view'             => true,
                'reservation_view'           => true,
                'reservation_create'         => true,
                'reservation_edit_basic'     => true,
                'reservation_edit_stay'      => true,
                'reservation_assign_room'    => true,
                'reservation_move_room'      => true,
                'reservation_checkin'        => true,
                'reservation_checkout'       => true,
                'reservation_cancel'         => true,
                'reservation_mark_no_show'   => true,
                'reservation_bulk_actions'   => true,
                'guest_view'                 => true,
                'guest_edit_contact'         => true,
                'guest_edit_flags'           => true,
                'guest_add_note'             => true,
                'payment_view'               => true,
                'payment_post'               => true,
                'payment_post_partial'       => true,
                'payment_mark_paid'          => true,
                'payment_refund'             => true,
                'payment_receipt_issue'      => true,
                'payment_invoice_issue'      => true,
                'payment_reconcile'          => true,
                'calendar_view'              => true,
                'calendar_move_reservation'  => true,
                'calendar_create_block'      => true,
                'calendar_edit_block'        => true,
                'housekeeping_view'          => true,
                'housekeeping_update_status' => true,
                'housekeeping_assign_staff'  => true,
                'housekeeping_inspect_room'  => true,
                'housekeeping_create_issue'  => true,
                'inventory_view'             => true,
                'availability_rules_view'    => true,
                'availability_rules_edit'    => true,
                'room_block_manage'          => true,
                'report_view_ops'            => true,
                'report_view_finance'        => true,
                'report_view_management'     => true,
                'report_export'              => true,
                'audit_view'                 => true,
                'plugin_settings_manage'     => false,
            ],
        ];
    }

    /**
     * @return array<string, array<string, bool>>
     */
    public static function getCapabilityMatrix(): array
    {
        $matrix = MustBookingConfig::get_setting('capability_matrix', self::getDefaultCapabilityMatrix());
        $defaults = self::getDefaultCapabilityMatrix();

        if (!\is_array($matrix)) {
            return $defaults;
        }

        foreach ($defaults as $role => $capabilities) {
            $row = isset($matrix[$role]) && \is_array($matrix[$role]) ? $matrix[$role] : [];

            foreach ($capabilities as $capability => $enabled) {
                $defaults[$role][$capability] = !empty($row[$capability]);
                unset($enabled);
            }
        }

        return $defaults;
    }

    /**
     * @return array<int, string>
     */
    public static function getPortalAccessRoles(): array
    {
        $defaults = [
            self::ROLE_FRONT_DESK,
            self::ROLE_SUPERVISOR,
            self::ROLE_HOUSEKEEPING,
            self::ROLE_FINANCE,
            self::ROLE_OPS_MANAGER,
        ];
        $saved = MustBookingConfig::get_setting('portal_access_roles', $defaults);
        $valid = [];

        foreach (\is_array($saved) ? $saved : [] as $role) {
            $normalized = self::normalizeRoleSlug((string) $role);

            if (isset(self::getRoleLabels()[$normalized])) {
                $valid[$normalized] = $normalized;
            }
        }

        return !empty($valid) ? \array_values($valid) : $defaults;
    }

    /**
     * @return array<int, string>
     */
    public static function getPortalRoleSlugs(): array
    {
        return \array_keys(self::getRoleLabels());
    }

    /**
     * @return array<int, string>
     */
    public static function getAllPluginCapabilities(): array
    {
        return \array_values(\array_unique(\array_merge(
            \array_values(self::getCapabilityKeyMap()),
            [self::CAP_ACCESS_PORTAL]
        )));
    }

    public static function getSettingsCapability(): string
    {
        return self::CAP_ACCESS_SETTINGS;
    }

    public static function currentUserCanManageSettings(): bool
    {
        return self::userCanManageSettings();
    }

    public static function userCanManageSettings(?\WP_User $user = null): bool
    {
        $user = $user instanceof \WP_User ? $user : \wp_get_current_user();

        if (!$user instanceof \WP_User || $user->ID <= 0) {
            return false;
        }

        if (\user_can($user, 'manage_options')) {
            return true;
        }

        return \user_can($user, self::getSettingsCapability());
    }

    public static function userCanAccessPortal(?\WP_User $user = null): bool
    {
        $user = $user instanceof \WP_User ? $user : \wp_get_current_user();

        if (!$user instanceof \WP_User || $user->ID <= 0) {
            return false;
        }

        if (\user_can($user, 'manage_options')) {
            return true;
        }

        if (self::isStaffUserDisabled($user)) {
            return false;
        }

        return \user_can($user, self::CAP_ACCESS_PORTAL);
    }

    /**
     * Returns true if this staff user has been plugin-disabled for portal access.
     * Admins (manage_options) are never considered disabled by this check.
     */
    public static function isStaffUserDisabled(?\WP_User $user = null): bool
    {
        $user = $user instanceof \WP_User ? $user : \wp_get_current_user();

        if (!$user instanceof \WP_User || $user->ID <= 0) {
            return false;
        }

        if (\user_can($user, 'manage_options')) {
            return false;
        }

        return (bool) \get_user_meta($user->ID, self::USERMETA_STAFF_DISABLED, true);
    }

    public static function userCanAccessPortalModule(string $moduleKey, ?\WP_User $user = null): bool
    {
        $user = $user instanceof \WP_User ? $user : \wp_get_current_user();

        if (!$user instanceof \WP_User || $user->ID <= 0) {
            return false;
        }

        if (\user_can($user, 'manage_options')) {
            return true;
        }

        if (!self::userCanAccessPortal($user)) {
            return false;
        }

        foreach (self::getPortalModuleCapabilities($moduleKey) as $capability) {
            if (\user_can($user, $capability)) {
                return true;
            }
        }

        return false;
    }

    public static function isPortalRestrictedUser(?\WP_User $user = null): bool
    {
        $user = $user instanceof \WP_User ? $user : \wp_get_current_user();

        if (!$user instanceof \WP_User || $user->ID <= 0 || \user_can($user, 'manage_options')) {
            return false;
        }

        return self::userCanAccessPortal($user) || self::userHasPortalRole($user);
    }

    public static function shouldHideWpAdminForUser(?\WP_User $user = null): bool
    {
        return !empty(MustBookingConfig::get_setting('hide_wp_admin_for_workers', true))
            && self::isPortalRestrictedUser($user);
    }

    public static function userHasPortalRole(?\WP_User $user = null): bool
    {
        $user = $user instanceof \WP_User ? $user : \wp_get_current_user();

        if (!$user instanceof \WP_User || $user->ID <= 0) {
            return false;
        }

        $roles = \is_array($user->roles) ? $user->roles : [];

        foreach ($roles as $role) {
            if (\in_array(self::normalizeRoleSlug((string) $role), self::getPortalRoleSlugs(), true)) {
                return true;
            }
        }

        return false;
    }

    public static function syncRoleCapabilities(): void
    {
        self::ensurePortalRolesExist();
        self::maybeMigrateLegacyRolesAndSettings();
        self::maybeApplyCapabilityAlignment();

        $roles = self::getRoleLabels();
        $matrix = self::getCapabilityMatrix();
        $portalRoles = self::getPortalAccessRoles();
        $capabilityMap = self::getCapabilityKeyMap();
        $allCaps = self::getAllPluginCapabilities();

        foreach ($roles as $roleSlug => $roleLabel) {
            $roleObject = \get_role($roleSlug);

            if (!$roleObject instanceof \WP_Role) {
                \add_role(
                    $roleSlug,
                    $roleLabel,
                    [
                        'read' => true,
                    ]
                );

                $roleObject = \get_role($roleSlug);
            }

            if (!$roleObject instanceof \WP_Role) {
                continue;
            }

            $roleObject->add_cap('read');

            foreach ($allCaps as $capability) {
                $roleObject->remove_cap($capability);
            }

            foreach ($capabilityMap as $capabilityKey => $capability) {
                if (!empty($matrix[$roleSlug][$capabilityKey])) {
                    $roleObject->add_cap($capability);
                }
            }

            if (\in_array($roleSlug, $portalRoles, true)) {
                $roleObject->add_cap(self::CAP_ACCESS_PORTAL);
            }
        }

        $administrator = \get_role('administrator');

        if ($administrator instanceof \WP_Role) {
            foreach ($allCaps as $capability) {
                $administrator->add_cap($capability);
            }
        }

        self::removeLegacyRoles();
    }

    /**
     * Maps legacy / superseded role slugs to their current equivalents.
     * This list is consulted during migration and normalisation.
     *
     * @return array<string, string>
     */
    private static function getLegacyRoleMap(): array
    {
        return [
            // Pre-v2 plugin roles (schema version 1 migration target)
            'receptionist' => self::ROLE_FRONT_DESK,
            'accountant'   => self::ROLE_FINANCE,
            'manager'      => self::ROLE_SUPERVISOR,
            // Schema version 1 roles (schema version 2 migration targets)
            'mhb_worker'   => self::ROLE_FRONT_DESK,
            'mhb_manager'  => self::ROLE_SUPERVISOR,
            // The old generic 'housekeeping' slug now maps to the dedicated role
            'housekeeping' => self::ROLE_HOUSEKEEPING,
        ];
    }

    private static function ensurePortalRolesExist(): void
    {
        foreach (self::getRoleLabels() as $roleSlug => $roleLabel) {
            if (\get_role($roleSlug) instanceof \WP_Role) {
                continue;
            }

            \add_role(
                $roleSlug,
                $roleLabel,
                [
                    'read' => true,
                ]
            );
        }
    }

    private static function maybeMigrateLegacyRolesAndSettings(): void
    {
        $version = (int) \get_option(self::LEGACY_ROLE_MIGRATION_OPTION, 0);

        if ($version >= self::LEGACY_ROLE_SCHEMA_VERSION) {
            return;
        }

        $legacyRoleMap = self::getLegacyRoleMap();
        $legacyRoles   = \array_keys($legacyRoleMap);

        $users = \get_users(
            [
                'role__in' => $legacyRoles,
                'fields'   => 'all',
            ]
        );

        foreach ($users as $user) {
            if (!$user instanceof \WP_User || \user_can($user, 'manage_options')) {
                continue;
            }

            $userRoles = \is_array($user->roles) ? $user->roles : [];

            // Determine the single best target role for this user, preferring
            // the highest-authority legacy role they hold.
            $targetRole = null;

            // Priority order: mhb_manager > manager > mhb_worker > accountant > housekeeping > receptionist
            $priorityMap = [
                'mhb_manager'  => 0,
                'manager'      => 1,
                'mhb_worker'   => 2,
                'accountant'   => 3,
                'housekeeping' => 4,
                'receptionist' => 5,
            ];

            $bestPriority = PHP_INT_MAX;

            foreach ($userRoles as $role) {
                if (isset($priorityMap[$role]) && $priorityMap[$role] < $bestPriority) {
                    $bestPriority = $priorityMap[$role];
                    $targetRole   = $legacyRoleMap[$role];
                }
            }

            if ($targetRole === null) {
                // Fallback: use normalizeRoleSlug on the first legacy role found
                foreach ($userRoles as $role) {
                    if (isset($legacyRoleMap[$role])) {
                        $targetRole = $legacyRoleMap[$role];
                        break;
                    }
                }
            }

            if ($targetRole !== null) {
                $user->add_role($targetRole);
            }

            foreach ($legacyRoles as $legacyRole) {
                if (\in_array($legacyRole, $userRoles, true)) {
                    $user->remove_role($legacyRole);
                }
            }
        }

        MustBookingConfig::set_group_settings(
            'staff_access',
            [
                'portal_access_roles' => self::getPortalAccessRoles(),
                'capability_matrix'   => self::getDefaultCapabilityMatrix(),
            ]
        );

        \update_option(self::LEGACY_ROLE_MIGRATION_OPTION, self::LEGACY_ROLE_SCHEMA_VERSION);
    }

    private static function removeLegacyRoles(): void
    {
        foreach (\array_keys(self::getLegacyRoleMap()) as $legacyRole) {
            // Only remove roles that are not part of the current role set.
            if (!isset(self::getRoleLabels()[$legacyRole])) {
                \remove_role($legacyRole);
            }
        }
    }

    private static function maybeApplyCapabilityAlignment(): void
    {
        $version = (int) \get_option(self::CAPABILITY_ALIGNMENT_OPTION, 0);

        if ($version >= self::CAPABILITY_ALIGNMENT_VERSION) {
            return;
        }

        $matrix = self::getCapabilityMatrix();

        if (
            isset($matrix[self::ROLE_FRONT_DESK])
            && \is_array($matrix[self::ROLE_FRONT_DESK])
        ) {
            $matrix[self::ROLE_FRONT_DESK]['housekeeping_assign_staff'] = false;
        }

        if (
            isset($matrix[self::ROLE_SUPERVISOR])
            && \is_array($matrix[self::ROLE_SUPERVISOR])
        ) {
            $matrix[self::ROLE_SUPERVISOR]['housekeeping_assign_staff'] = true;
        }

        MustBookingConfig::set_group_settings(
            'staff_access',
            [
                'capability_matrix' => $matrix,
            ]
        );

        \update_option(self::CAPABILITY_ALIGNMENT_OPTION, self::CAPABILITY_ALIGNMENT_VERSION);
    }

    private static function normalizeRoleSlug(string $role): string
    {
        $role = \sanitize_key($role);
        $legacyMap = self::getLegacyRoleMap();

        return isset($legacyMap[$role]) ? $legacyMap[$role] : $role;
    }
}
