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
        if (!field.setText("Edited synthetic dialogue")) {
            throw new AssertionError("Accessibility could not replace the dialogue text");
        }
        if (!"Edited synthetic dialogue".equals(field.getText())) {
            throw new AssertionError("Accessibility input did not retain the exact dialogue text");
        }
        System.out.println("DIALOGUE_INPUT_TEST_PASS");
    }
}
