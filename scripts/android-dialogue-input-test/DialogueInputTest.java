package com.xbaconator.essentialsstudiomobile.smoketests;

import com.android.uiautomator.core.UiObject;
import com.android.uiautomator.core.UiSelector;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;

public class DialogueInputTest extends UiAutomatorTestCase {
    public void testSetFocusedDialogueText() throws Exception {
        UiObject field = new UiObject(
            new UiSelector().className("android.widget.EditText").focused(true)
        );
        if (!field.waitForExists(10000)) {
            throw new AssertionError("No focused Android dialogue input was exposed");
        }
        boolean accepted = field.setText("Edited synthetic dialogue");
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
            "DIALOGUE_INPUT_RESULT method=UiObject.setText accepted=" + accepted
                + " text=" + actual
        );
        if (!accepted || !"Edited synthetic dialogue".equals(actual)) {
            throw new AssertionError(
                "Keyboard input did not retain exact dialogue text; accepted="
                    + accepted + ", actual=" + actual
            );
        }
        System.out.println("DIALOGUE_INPUT_TEST_PASS");
    }
}
