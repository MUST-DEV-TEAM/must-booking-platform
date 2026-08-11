<?php

if (!\defined('ABSPATH')) {
    exit;
}

$view = \must_hotel_booking\get_single_room_page_view_data();
$is_valid = !empty($view['is_valid']);
$message = (string) ($view['message'] ?? '');
$room = \is_array($view['room'] ?? null) ? $view['room'] : [];
$related_rooms = \is_array($view['related_rooms'] ?? null) ? $view['related_rooms'] : [];
$booking_url = (string) ($view['booking_url'] ?? \home_url('/booking'));
$room_url = (string) ($view['room_url'] ?? \home_url('/room-details'));
$arrow_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/ArrowRight.svg' : '';
$people_icon_url = \defined('MUST_HOTEL_BOOKING_URL') ? MUST_HOTEL_BOOKING_URL . 'assets/img/PeopleFill.svg' : '';

$room_name = (string) ($room['name'] ?? '');
$room_type_id = (string) ($room['room_type_id'] ?? '');
$room_id = (string) ($room['room_id'] ?? '');
$category_label = (string) ($room['category_label'] ?? '');
$description = (string) ($room['description'] ?? '');
$max_guests = (int) ($room['max_guests'] ?? 0);
$view_type = (string) ($room['view_type'] ?? '');
$floor = (int) ($room['floor'] ?? 0);
$rate_plans = \is_array($room['rate_plans'] ?? null) ? $room['rate_plans'] : [];
$amenities = \is_array($room['amenities'] ?? null) ? $room['amenities'] : [];
$primary_image_url = (string) ($room['primary_image_url'] ?? '');
$gallery_images = \is_array($room['gallery_images'] ?? null) ? $room['gallery_images'] : [];
$lightbox_images = \is_array($room['lightbox_images'] ?? null) ? $room['lightbox_images'] : [];
$lightbox_json = \wp_json_encode($lightbox_images);
$lightbox_attr = \is_string($lightbox_json) ? \esc_attr($lightbox_json) : '[]';
?>
<?php \get_header(); ?>
<main class="must-hotel-booking-page must-hotel-booking-page-single-room">
    <article class="must-hotel-booking-single-room">
        <?php if (!$is_valid) : ?>
            <section class="must-hotel-booking-single-room-section">
                <h1><?php echo \esc_html__('Accommodation unavailable', 'must-hotel-booking'); ?></h1>
                <p><?php echo \esc_html($message !== '' ? $message : __('This accommodation could not be found.', 'must-hotel-booking')); ?></p>
                <a class="must-hotel-booking-single-room-action-link" href="<?php echo \esc_url($room_url); ?>">
                    <span><?php echo \esc_html__('Browse accommodations', 'must-hotel-booking'); ?></span>
                </a>
            </section>
        <?php else : ?>
            <div class="must-hotel-booking-single-room-grid">
                <div class="must-hotel-booking-single-room-content">
                    <h1 class="must-hotel-booking-single-room-title"><?php echo \esc_html($room_name); ?></h1>

                    <div class="must-hotel-booking-single-room-actions">
                        <a class="must-hotel-booking-single-room-action-link" href="<?php echo \esc_url($booking_url); ?>">
                            <span><?php echo \esc_html__('Book Now', 'must-hotel-booking'); ?></span>
                            <?php if ($arrow_icon_url !== '') : ?><img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" /><?php endif; ?>
                        </a>
                    </div>

                    <?php if ($category_label !== '' || $max_guests > 0 || $view_type !== '' || $floor > 0) : ?>
                        <div class="must-hotel-booking-single-room-meta">
                            <?php if ($category_label !== '') : ?><p><?php echo \esc_html($category_label); ?></p><?php endif; ?>
                            <?php if ($max_guests > 0) : ?><p><?php if ($people_icon_url !== '') : ?><img src="<?php echo \esc_url($people_icon_url); ?>" alt="" aria-hidden="true" /><?php endif; ?><?php echo \esc_html(\sprintf(_n('Up to %d guest', 'Up to %d guests', $max_guests, 'must-hotel-booking'), $max_guests)); ?></p><?php endif; ?>
                            <?php if ($view_type !== '') : ?><p><?php echo \esc_html($view_type); ?></p><?php endif; ?>
                            <?php if ($floor > 0) : ?><p><?php echo \esc_html(\sprintf(__('Floor %d', 'must-hotel-booking'), $floor)); ?></p><?php endif; ?>
                        </div>
                    <?php endif; ?>

                    <?php if ($description !== '') : ?><p class="must-hotel-booking-single-room-description"><?php echo \esc_html($description); ?></p><?php endif; ?>

                    <?php if ($rate_plans !== []) : ?>
                        <section class="must-hotel-booking-single-room-section must-hotel-booking-single-room-price">
                            <h2><?php echo \esc_html__('Available rates', 'must-hotel-booking'); ?></h2>
                            <p><?php echo \esc_html(\implode(' · ', \array_map('strval', $rate_plans))); ?></p>
                        </section>
                    <?php endif; ?>

                    <?php if ($amenities !== []) : ?>
                        <section class="must-hotel-booking-single-room-section">
                            <h2><?php echo \esc_html__('Amenities', 'must-hotel-booking'); ?></h2>
                            <div class="must-hotel-booking-single-room-amenities-grid">
                                <?php foreach ($amenities as $amenity) : ?>
                                    <?php $label = (string) ($amenity['label'] ?? ''); $icon = (string) ($amenity['icon'] ?? ''); ?>
                                    <?php if ($label === '') { continue; } ?>
                                    <div class="must-hotel-booking-single-room-amenity-item">
                                        <?php if ($icon !== '') : ?><span class="must-hotel-booking-single-room-amenity-icon-wrap"><img src="<?php echo \esc_url($icon); ?>" alt="" aria-hidden="true" /></span><?php endif; ?>
                                        <span><?php echo \esc_html($label); ?></span>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        </section>
                    <?php endif; ?>
                </div>

                <div class="must-hotel-booking-single-room-media" data-lightbox-images="<?php echo $lightbox_attr; ?>" data-lightbox-title="<?php echo \esc_attr($room_name); ?>">
                    <div class="must-hotel-booking-single-room-main-media">
                        <?php if ($primary_image_url !== '') : ?>
                            <button type="button" class="must-hotel-booking-single-room-main-image-trigger" data-lightbox-index="0"><img class="must-hotel-booking-single-room-main-image" src="<?php echo \esc_url($primary_image_url); ?>" alt="<?php echo \esc_attr($room_name); ?>" /></button>
                        <?php else : ?>
                            <div class="must-hotel-booking-single-room-image-placeholder"><?php echo \esc_html__('Image unavailable', 'must-hotel-booking'); ?></div>
                        <?php endif; ?>
                    </div>
                    <div class="must-hotel-booking-single-room-thumbs">
                        <?php foreach (\array_slice($gallery_images, 0, 3) as $gallery_image) : ?>
                            <?php $lightbox_index = \array_search($gallery_image, $lightbox_images, true); ?>
                            <button type="button" class="must-hotel-booking-single-room-thumb-button" data-lightbox-index="<?php echo \esc_attr((string) ($lightbox_index === false ? 0 : $lightbox_index)); ?>"><img src="<?php echo \esc_url((string) $gallery_image); ?>" alt="" loading="lazy" /></button>
                        <?php endforeach; ?>
                        <?php for ($i = \count($gallery_images); $i < 3; $i++) : ?><span class="must-hotel-booking-single-room-thumb-placeholder" aria-hidden="true"></span><?php endfor; ?>
                    </div>
                </div>
            </div>

            <?php if ($amenities !== []) : ?>
                <section class="must-hotel-booking-included-accommodations-section">
                    <div class="must-hotel-booking-included-accommodations-inner">
                        <p class="must-hotel-booking-included-accommodations-kicker"><?php echo \esc_html__('Included accommodations', 'must-hotel-booking'); ?></p>
                        <h2 class="must-hotel-booking-included-accommodations-title"><?php echo \esc_html__('Everything for your stay', 'must-hotel-booking'); ?></h2>
                        <div class="must-hotel-booking-included-accommodations-grid">
                            <?php foreach (\array_slice($amenities, 0, 5) as $amenity) : ?>
                                <?php $label = (string) ($amenity['label'] ?? ''); $icon = (string) ($amenity['icon'] ?? ''); ?>
                                <?php if ($label === '') { continue; } ?>
                                <article class="must-hotel-booking-included-accommodations-card">
                                    <?php if ($icon !== '') : ?><span class="must-hotel-booking-included-accommodations-icon-wrap"><img src="<?php echo \esc_url($icon); ?>" alt="" aria-hidden="true" /></span><?php endif; ?>
                                    <h3><?php echo \esc_html($label); ?></h3>
                                </article>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </section>
            <?php endif; ?>

            <?php if ($related_rooms !== []) : ?>
                <section class="must-hotel-booking-related-rooms-section">
                    <div class="must-hotel-booking-related-rooms-inner">
                        <p class="must-hotel-booking-related-rooms-kicker"><?php echo \esc_html__('Related rooms', 'must-hotel-booking'); ?></p>
                        <div class="must-hotel-booking-related-rooms-grid">
                            <?php foreach ($related_rooms as $related_room) : ?>
                                <?php
                                $related_name = (string) ($related_room['name'] ?? '');
                                $related_images = \is_array($related_room['lightbox_images'] ?? null) ? $related_room['lightbox_images'] : [];
                                $related_primary = (string) ($related_room['primary_image_url'] ?? '');
                                $related_images_json = \wp_json_encode($related_images);
                                $related_images_attr = \is_string($related_images_json) ? \esc_attr($related_images_json) : '[]';
                                ?>
                                <article class="must-hotel-booking-related-room-card" data-related-room-images="<?php echo $related_images_attr; ?>" data-related-room-title="<?php echo \esc_attr($related_name); ?>">
                                    <div class="must-hotel-booking-related-room-media">
                                        <?php if ($related_primary !== '') : ?>
                                            <button type="button" class="must-hotel-booking-related-room-image-trigger"><img class="must-hotel-booking-related-room-image" src="<?php echo \esc_url($related_primary); ?>" alt="<?php echo \esc_attr($related_name); ?>" loading="lazy" /></button>
                                            <?php if (\count($related_images) > 1) : ?>
                                                <button type="button" class="must-hotel-booking-related-room-arrow must-hotel-booking-related-room-arrow-prev" aria-label="<?php echo \esc_attr__('Previous image', 'must-hotel-booking'); ?>"><?php if ($arrow_icon_url !== '') : ?><img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" /><?php endif; ?></button>
                                                <button type="button" class="must-hotel-booking-related-room-arrow must-hotel-booking-related-room-arrow-next" aria-label="<?php echo \esc_attr__('Next image', 'must-hotel-booking'); ?>"><?php if ($arrow_icon_url !== '') : ?><img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" /><?php endif; ?></button>
                                            <?php endif; ?>
                                        <?php else : ?>
                                            <div class="must-hotel-booking-related-room-image-placeholder"><?php echo \esc_html__('Image unavailable', 'must-hotel-booking'); ?></div>
                                        <?php endif; ?>
                                    </div>
                                    <div class="must-hotel-booking-related-room-content">
                                        <h3><?php echo \esc_html($related_name); ?></h3>
                                        <div class="must-hotel-booking-related-room-actions">
                                            <a class="must-hotel-booking-related-room-book" href="<?php echo \esc_url((string) ($related_room['booking_url'] ?? '')); ?>"><span><?php echo \esc_html__('Book Now', 'must-hotel-booking'); ?></span><?php if ($arrow_icon_url !== '') : ?><img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" /><?php endif; ?></a>
                                            <a class="must-hotel-booking-related-room-details" href="<?php echo \esc_url((string) ($related_room['details_url'] ?? '')); ?>"><span><?php echo \esc_html__('More Details', 'must-hotel-booking'); ?></span><?php if ($arrow_icon_url !== '') : ?><img src="<?php echo \esc_url($arrow_icon_url); ?>" alt="" aria-hidden="true" /><?php endif; ?></a>
                                        </div>
                                    </div>
                                </article>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </section>
            <?php endif; ?>
        <?php endif; ?>
    </article>
</main>
<?php \get_footer(); ?>
