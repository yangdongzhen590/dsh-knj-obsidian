package com.pingan.iobs.order;

/**
 * 订单状态
 */
public enum OrderStatus {
    CREATED("01", "已创建"),
    PAID("02", "已支付"),
    SHIPPED("03", "已发货"),
    CANCELLED("99", "已取消");

    private final String code;
    private final String label;

    OrderStatus(String code, String label) {
        this.code = code;
        this.label = label;
    }
}
