package com.xbaconator.essentialsstudiomobile.smoketests;

import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;

import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

public class DialogueInputTest extends UiAutomatorTestCase {
    public void testSetFocusedDialogueText() throws Exception {
        AccessibilityObject field = new AccessibilityObject(
            new UiSelector().className("android.widget.EditText").focused(true)
        );
        if (!field.waitForExists(10000)) {
            throw new AssertionError("No focused Android dialogue input was exposed");
        }
        AccessibilityNodeInfo fieldNode = field.findNode();
        if (fieldNode == null) {
            throw new AssertionError("Focused Android dialogue input disappeared");
        }
        Bundle arguments = new Bundle();
        arguments.putCharSequence(
            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
            "Edited synthetic dialogue"
        );
        boolean accepted = fieldNode.performAction(
            AccessibilityNodeInfo.ACTION_SET_TEXT, arguments
        );
        String actual = null;
        long deadline = System.currentTimeMillis() + 5000;
        while (System.currentTimeMillis() < deadline) {
            actual = field.getText();
            if ("Edited synthetic dialogue".equals(actual)) {
                break;
            }
            Thread.sleep(100);
        }
        System.out.println(
            "DIALOGUE_INPUT_RESULT method=ACTION_SET_TEXT accepted=" + accepted
                + " text=" + actual
        );
        if (!accepted || !"Edited synthetic dialogue".equals(actual)) {
            throw new AssertionError(
                "Accessibility replacement did not retain exact dialogue text; accepted="
                    + accepted + ", actual=" + actual
            );
        }

        AccessibilityObject ok = new AccessibilityObject(
            new UiSelector().className("android.widget.Button").text("OK").clickable(true)
        );
        if (!ok.waitForExists(10000)) {
            throw new AssertionError("The single dialogue OK action was not exposed");
        }
        AccessibilityNodeInfo okNode = ok.findNode();
        if (okNode == null || !okNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            throw new AssertionError("Accessibility could not activate the dialogue OK action");
        }
        UiObject committedRow = new UiObject(
            new UiSelector().className("android.view.View")
                .textContains("Edited synthetic dialogue")
        );
        UiObject saveAndClose = new UiObject(
            new UiSelector().className("android.widget.Button").text("Save & close")
        );
        if (!committedRow.waitForExists(10000) || !saveAndClose.waitForExists(10000)) {
            throw new AssertionError(
                "Dialogue OK did not return to the event command list with Save & close available"
            );
        }
        System.out.println("DIALOGUE_OK_ACTION_PASS");
        System.out.println("DIALOGUE_INPUT_TEST_PASS");
    }

    private static class AccessibilityObject extends UiObject {
        AccessibilityObject(UiSelector selector) {
            super(selector);
        }

        AccessibilityNodeInfo findNode() throws Exception {
            return findAccessibilityNodeInfo(10000);
        }
    }
}
