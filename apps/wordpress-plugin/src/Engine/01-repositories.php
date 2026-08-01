<?php

namespace MustHotelBooking\Engine;

use MustHotelBooking\Database\AvailabilityRepository;
use MustHotelBooking\Database\ActivityRepository;
use MustHotelBooking\Database\CancellationPolicyRepository;
use MustHotelBooking\Database\GuestRepository;
use MustHotelBooking\Database\HousekeepingRepository;
use MustHotelBooking\Database\InventoryRepository;
use MustHotelBooking\Database\PaymentRepository;
use MustHotelBooking\Database\RefundRepository;
use MustHotelBooking\Database\ReportRepository;
use MustHotelBooking\Database\RatePlanRepository;
use MustHotelBooking\Database\ReservationRepository;
use MustHotelBooking\Database\RoomCategoryRepository;
use MustHotelBooking\Database\RoomRepository;

function get_room_repository(): RoomRepository
{
    static $repository = null;

    if (!$repository instanceof RoomRepository) {
        $repository = new RoomRepository();
    }

    return $repository;
}

function get_guest_repository(): GuestRepository
{
    static $repository = null;

    if (!$repository instanceof GuestRepository) {
        $repository = new GuestRepository();
    }

    return $repository;
}

function get_room_category_repository(): RoomCategoryRepository
{
    static $repository = null;

    if (!$repository instanceof RoomCategoryRepository) {
        $repository = new RoomCategoryRepository();
    }

    return $repository;
}


function get_inventory_repository(): InventoryRepository
{
    static $repository = null;

    if (!$repository instanceof InventoryRepository) {
        $repository = new InventoryRepository();
    }

    return $repository;
}

function get_housekeeping_repository(): HousekeepingRepository
{
    static $repository = null;

    if (!$repository instanceof HousekeepingRepository) {
        $repository = new HousekeepingRepository();
    }

    return $repository;
}

function get_report_repository(): ReportRepository
{
    static $repository = null;

    if (!$repository instanceof ReportRepository) {
        $repository = new ReportRepository();
    }

    return $repository;
}

function get_reservation_repository(): ReservationRepository
{
    static $repository = null;

    if (!$repository instanceof ReservationRepository) {
        $repository = new ReservationRepository();
    }

    return $repository;
}

function get_availability_repository(): AvailabilityRepository
{
    static $repository = null;

    if (!$repository instanceof AvailabilityRepository) {
        $repository = new AvailabilityRepository();
    }

    return $repository;
}

function get_activity_repository(): ActivityRepository
{
    static $repository = null;

    if (!$repository instanceof ActivityRepository) {
        $repository = new ActivityRepository();
    }

    return $repository;
}

function get_payment_repository(): PaymentRepository
{
    static $repository = null;

    if (!$repository instanceof PaymentRepository) {
        $repository = new PaymentRepository();
    }

    return $repository;
}

function get_refund_repository(): RefundRepository
{
    static $repository = null;

    if (!$repository instanceof RefundRepository) {
        $repository = new RefundRepository();
    }

    return $repository;
}


function get_rate_plan_repository(): RatePlanRepository
{
    static $repository = null;

    if (!$repository instanceof RatePlanRepository) {
        $repository = new RatePlanRepository();
    }

    return $repository;
}

function get_cancellation_policy_repository(): CancellationPolicyRepository
{
    static $repository = null;

    if (!$repository instanceof CancellationPolicyRepository) {
        $repository = new CancellationPolicyRepository();
    }

    return $repository;
}
