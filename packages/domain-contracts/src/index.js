"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingPaymentMethod = exports.BookingStatus = void 0;
var BookingStatus;
(function (BookingStatus) {
    BookingStatus["DRAFT"] = "DRAFT";
    BookingStatus["QUOTED"] = "QUOTED";
    BookingStatus["INVENTORY_REVALIDATING"] = "INVENTORY_REVALIDATING";
    BookingStatus["PAYMENT_PENDING"] = "PAYMENT_PENDING";
    BookingStatus["PAYMENT_NOT_REQUIRED"] = "PAYMENT_NOT_REQUIRED";
    BookingStatus["PMS_CREATION_PENDING"] = "PMS_CREATION_PENDING";
    BookingStatus["PMS_CONFIRMATION_PENDING"] = "PMS_CONFIRMATION_PENDING";
    BookingStatus["CONFIRMED"] = "CONFIRMED";
    BookingStatus["AVAILABILITY_FAILED"] = "AVAILABILITY_FAILED";
    BookingStatus["PAYMENT_FAILED"] = "PAYMENT_FAILED";
    BookingStatus["PMS_UNKNOWN_RESULT"] = "PMS_UNKNOWN_RESULT";
    BookingStatus["PMS_REJECTED"] = "PMS_REJECTED";
    BookingStatus["MANUAL_REVIEW"] = "MANUAL_REVIEW";
    BookingStatus["CANCELLED"] = "CANCELLED";
    BookingStatus["EXPIRED"] = "EXPIRED";
})(BookingStatus || (exports.BookingStatus = BookingStatus = {}));
var BookingPaymentMethod;
(function (BookingPaymentMethod) {
    BookingPaymentMethod["STRIPE_CHECKOUT"] = "STRIPE_CHECKOUT";
    BookingPaymentMethod["POKPAY"] = "POKPAY";
    BookingPaymentMethod["PAY_AT_HOTEL"] = "PAY_AT_HOTEL";
    BookingPaymentMethod["FREE"] = "FREE";
})(BookingPaymentMethod || (exports.BookingPaymentMethod = BookingPaymentMethod = {}));
__exportStar(require("./capture"), exports);
__exportStar(require("./hotel-profile-rules"), exports);
__exportStar(require("./booking-window-rules"), exports);
