package com.xbaconator.essentialsstudiomobile.smoketests;

import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;

import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

public class DialogueInputTest extends UiAutomatorTestCase {
    public void testSetFocusedDialogueText() throws Exception {
        AccessibilityField field = new AccessibilityField(
            new UiSelector().className("android.widget.EditText").focused(true)
        );
        if (!field.waitForExists(10000)) {
            throw new AssertionError("No focused Android dialogue input was exposed");
        }
        AccessibilityNodeInfo node = field.findNode();
        if (node == null) {
            throw new AssertionError("Focused dialogue input disappeared from accessibility");
        }
        int actions = node.getActions();
        if ((actions & AccessibilityNodeInfo.ACTION_SET_TEXT) == 0) {
            throw new AssertionError(
                "Focused dialogue input does not expose ACTION_SET_TEXT; actions=" + actions
            );
        }
        Bundle arguments = new Bundle();
        arguments.putCharSequence(
            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
            "Edited synthetic dialogue"
        );
        boolean accepted = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments);
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
            "DIALOGUE_INPUT_RESULT accepted=" + accepted
                + " actions=" + actions
                + " text=" + actual
        );
        if (!accepted || !"Edited synthetic dialogue".equals(actual)) {
            throw new AssertionError(
                "ACTION_SET_TEXT did not retain exact dialogue text; accepted="
                    + accepted + ", actions=" + actions + ", actual=" + actual
            );
        }
        System.out.println("DIALOGUE_INPUT_TEST_PASS");
    }

    private static class AccessibilityField extends UiObject {
        AccessibilityField(UiSelector selector) {
            super(selector);
        }

        AccessibilityNodeInfo findNode() throws Exception {
            return findAccessibilityNodeInfo(10000);
        }
    }
}
